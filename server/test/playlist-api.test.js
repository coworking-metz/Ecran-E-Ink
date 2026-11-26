// Playlist par écran : validation, rotation, périodes de diffusion, slide de repli, ordre, options, migration.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import sharp from 'sharp'
import { startServer } from './harness.js'

let srv
const auth = { Authorization: 'Bearer pw' }
const api = (method, path, body, headers = auth) =>
  fetch(srv.base + path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
const json = async (method, path, body) => (await api(method, path, body)).json()
const iso = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString()

// Une création avec une image rendue ; `shade` la distingue des autres (hash différent).
async function creation(name, shade) {
  const c = await json('POST', '/api/creations', { name })
  const png = (await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: shade, g: shade, b: shade } } }).png().toBuffer()).toString('base64')
  await api('PUT', `/api/creations/${c.id}`, { png: `data:image/png;base64,${png}` })
  return (await json('GET', `/api/creations/${c.id}`))
}
const device = () => json('POST', '/api/devices', { name: 'test' })
const current = async (dev) => (await fetch(srv.base + '/api/device/current', { headers: { Authorization: `Bearer ${dev.token}` } })).json()

before(async () => { srv = await startServer({ ADMIN_PASSWORD: 'pw' }) })
after(() => srv?.stop())

test('options : valeurs par défaut, validation, persistance', async () => {
  assert.deepEqual(await json('GET', '/api/settings'), { default_slide_seconds: 120, fallback_creation_id: null })
  assert.equal((await api('PUT', '/api/settings', { default_slide_seconds: 10 })).status, 400, 'sous le plancher')
  assert.equal((await api('PUT', '/api/settings', { default_slide_seconds: 'abc' })).status, 400)
  assert.equal((await api('PUT', '/api/settings', { fallback_creation_id: 99999 })).status, 400, 'création inconnue')
  assert.equal((await json('PUT', '/api/settings', { default_slide_seconds: 90 })).default_slide_seconds, 90)
  assert.equal((await json('GET', '/api/settings')).default_slide_seconds, 90)
  await json('PUT', '/api/settings', { default_slide_seconds: 120 })
})

test('slide : validation de la durée, des dates et de la création', async () => {
  const dev = await device(), c = await creation('v', 100)
  const add = (b) => api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id, ...b })
  assert.equal((await add({ duration_seconds: 10 })).status, 400, 'durée sous le plancher')
  assert.equal((await add({ duration_seconds: 1.5 })).status, 400)
  assert.equal((await add({ starts_at: 'pas une date' })).status, 400)
  assert.equal((await add({ starts_at: iso(100), ends_at: iso(50) })).status, 400, 'fin avant début')
  assert.equal((await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: 99999 })).status, 400)
  assert.equal((await api('POST', `/api/devices/99999/slides`, { creation_id: c.id })).status, 404)
  const ok = await add({ duration_seconds: 45, starts_at: iso(-60), ends_at: iso(3600) })
  assert.equal(ok.status, 200)
  const slide = await ok.json()
  assert.equal(slide.duration_seconds, 45)
  assert.equal((await api('PATCH', `/api/slides/${slide.id}`, { duration_seconds: null })).status, 200, 'retour à la durée par défaut')
  assert.equal((await api('PATCH', `/api/slides/${slide.id}`, { ends_at: slide.starts_at })).status, 400)
})

test('rotation : le Pi reçoit un des slides, un délai de retour court, et une image autorisée', async () => {
  const dev = await device(), a = await creation('a', 30), b = await creation('b', 200)
  for (const c of [a, b]) await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id, duration_seconds: 30 })
  const cur = await current(dev)
  assert.equal(cur.slide_count, 2)
  assert.ok([a.png_hash, b.png_hash].includes(cur.hash))
  assert.ok(cur.next_check_seconds >= 5 && cur.next_check_seconds <= 31, `retour dans ${cur.next_check_seconds}s`)
  const img = await fetch(srv.base + cur.image_url, { headers: { Authorization: `Bearer ${dev.token}` } })
  assert.equal(img.status, 200)
})

test("sécurité : un jeton d'écran ne donne pas accès aux créations hors de sa playlist", async () => {
  const dev = await device(), mine = await creation('mine', 50), other = await creation('other', 150)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: mine.id })
  const h = { Authorization: `Bearer ${dev.token}` }
  assert.equal((await fetch(`${srv.base}/api/device/image?creation=${mine.id}`, { headers: h })).status, 200)
  assert.equal((await fetch(`${srv.base}/api/device/image?creation=${other.id}`, { headers: h })).status, 404)
})

test('période : slide échu ou à venir non diffusé ; la date de retour tient compte du prochain début', async () => {
  const dev = await device(), always = await creation('always', 10), expired = await creation('expired', 90), later = await creation('later', 170)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: always.id })
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: expired.id, ends_at: iso(-10) })
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: later.id, starts_at: iso(40) })
  const cur = await current(dev)
  assert.equal(cur.slide_count, 1)
  assert.equal(cur.hash, always.png_hash)
  assert.ok(cur.next_check_seconds <= 42, `doit revenir au début du slide à venir (dans ${cur.next_check_seconds}s)`)
})

test('repli : sans slide actif, le slide de repli des options est affiché', async () => {
  const dev = await device(), fb = await creation('repli', 128), old = await creation('old', 77)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: old.id, ends_at: iso(-5) })
  assert.equal((await current(dev)).hash, null, 'rien à afficher sans repli')
  await json('PUT', '/api/settings', { fallback_creation_id: fb.id })
  const cur = await current(dev)
  assert.equal(cur.hash, fb.png_hash)
  assert.equal(cur.slide_count, 0)
  assert.equal((await fetch(srv.base + cur.image_url, { headers: { Authorization: `Bearer ${dev.token}` } })).status, 200)
  await json('PUT', '/api/settings', { fallback_creation_id: null })
})

test('ordre : réordonnable, et refus d’une liste incomplète', async () => {
  const dev = await device(), a = await creation('o1', 20), b = await creation('o2', 60)
  const s1 = await json('POST', `/api/devices/${dev.id}/slides`, { creation_id: a.id })
  const s2 = await json('POST', `/api/devices/${dev.id}/slides`, { creation_id: b.id })
  assert.equal((await api('PUT', `/api/devices/${dev.id}/slides/order`, { ids: [s1.id] })).status, 400)
  assert.equal((await api('PUT', `/api/devices/${dev.id}/slides/order`, { ids: [s2.id, s1.id] })).status, 200)
  const list = (await json('GET', '/api/devices')).find((d) => d.id === dev.id).slides
  assert.deepEqual(list.map((s) => s.id), [s2.id, s1.id])
})

test('supprimer une création la retire des playlists ; supprimer un slide ne supprime pas la création', async () => {
  const dev = await device(), c = await creation('del', 99), d = await creation('keep', 140)
  const s = await json('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id })
  const s2 = await json('POST', `/api/devices/${dev.id}/slides`, { creation_id: d.id })
  await api('DELETE', `/api/creations/${c.id}`)
  await api('DELETE', `/api/slides/${s2.id}`)
  const slides = (await json('GET', '/api/devices')).find((x) => x.id === dev.id).slides
  assert.equal(slides.length, 0, `slides restants : ${JSON.stringify(slides.map((x) => x.id))} (s=${s.id})`)
  assert.equal((await api('GET', `/api/creations/${d.id}`)).status, 200)
})

test('migration : l’ancien « une création par écran » devient le premier slide', async () => {
  const old = await startServer({ ADMIN_PASSWORD: 'pw' }, {
    setup: (dir) => {
      const db = new DatabaseSync(join(dir, 'eink.db'))
      db.exec(`
        CREATE TABLE creations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, scene TEXT NOT NULL, png_hash TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, width INTEGER NOT NULL DEFAULT 1200, height INTEGER NOT NULL DEFAULT 825, refresh_seconds INTEGER NOT NULL DEFAULT 300, creation_id INTEGER REFERENCES creations(id) ON DELETE SET NULL, last_seen TEXT);
        CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, width INTEGER, height INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO creations (name, scene, png_hash) VALUES ('ancienne', '{"width":1200,"height":825,"background":"#fff","layers":[]}', 'abc');
        INSERT INTO devices (name, token, creation_id) VALUES ('vieil écran', 'tok', 1);
      `)
      db.close()
    },
  })
  try {
    const devs = await (await fetch(old.base + '/api/devices', { headers: auth })).json()
    assert.equal(devs.length, 1)
    assert.equal(devs[0].slides.length, 1)
    assert.equal(devs[0].slides[0].creation_id, 1)
    assert.equal(devs[0].slides[0].enabled, 1)
  } finally { await old.stop() }
})
