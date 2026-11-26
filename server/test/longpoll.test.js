// Long-polling de /api/device/current : réveil immédiat sur modification, expiration, fin de créneau, isolation entre écrans.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { startServer } from './harness.js'

let srv
const admin = { Authorization: 'Bearer pw' }
const api = (method, path, body) =>
  fetch(srv.base + path, { method, headers: { ...admin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
const json = async (method, path, body) => (await api(method, path, body)).json()
const iso = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString()

async function creation(name, shade) {
  const c = await json('POST', '/api/creations', { name })
  await setImage(c.id, shade)
  return json('GET', `/api/creations/${c.id}`)
}
async function setImage(id, shade) {
  const png = (await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: shade, g: shade, b: shade } } }).png().toBuffer()).toString('base64')
  await api('PUT', `/api/creations/${id}`, { png: `data:image/png;base64,${png}` })
}
const device = () => json('POST', '/api/devices', { name: 'lp' })
// Appel de l'écran ; renvoie la réponse et la durée (ms).
async function current(dev, query = '', signal) {
  const t0 = Date.now()
  const res = await fetch(`${srv.base}/api/device/current${query}`, { headers: { Authorization: `Bearer ${dev.token}` }, signal })
  return { body: await res.json(), ms: Date.now() - t0, status: res.status }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

before(async () => { srv = await startServer({ ADMIN_PASSWORD: 'pw' }) })
after(() => srv?.stop())

test('sans version : réponse immédiate, avec un jeton de version', async () => {
  const dev = await device()
  const { body, ms } = await current(dev, '?wait=30')
  assert.ok(ms < 500, `immédiat (${ms} ms)`)
  assert.match(body.version, /^[0-9a-f]{8}\.\d+$/)
})

test('version périmée ou d’un autre démarrage du serveur : réponse immédiate (resynchronisation)', async () => {
  const dev = await device()
  const { ms } = await current(dev, '?wait=30&v=ancienboot.42')
  assert.ok(ms < 500, `immédiat (${ms} ms)`)
})

test('rien ne change : la réponse arrive à la fin de l’attente, inchangée', async () => {
  const dev = await device()
  const { body: first } = await current(dev)
  const { body, ms } = await current(dev, `?wait=1&v=${first.version}`)
  assert.ok(ms >= 900 && ms < 2500, `attente d'environ 1 s (${ms} ms)`)
  assert.equal(body.version, first.version)
})

test('le dashboard ajoute un slide : l’écran est réveillé tout de suite', async () => {
  const dev = await device(), c = await creation('lp1', 90)
  const { body: first } = await current(dev)
  assert.equal(first.hash, null)
  const waiting = current(dev, `?wait=20&v=${first.version}`)
  await sleep(150)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id })
  const { body, ms } = await waiting
  assert.ok(ms < 2000, `réveillé en ${ms} ms (et non après 20 s)`)
  assert.equal(body.hash, c.png_hash)
  assert.notEqual(body.version, first.version)
})

test('la création affichée est ré-enregistrée : l’écran reçoit la nouvelle image immédiatement', async () => {
  const dev = await device(), c = await creation('lp2', 40)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id })
  const { body: first } = await current(dev)
  const waiting = current(dev, `?wait=20&v=${first.version}`)
  await sleep(150)
  await setImage(c.id, 200)
  const { body, ms } = await waiting
  assert.ok(ms < 2000, `réveillé en ${ms} ms`)
  assert.notEqual(body.hash, first.hash)
})

test('un autre écran n’est pas réveillé par une modification qui ne le concerne pas', async () => {
  const a = await device(), b = await device(), c = await creation('lp3', 120)
  const { body: fb } = await current(b)
  const waitingB = current(b, `?wait=2&v=${fb.version}`)
  await sleep(150)
  await api('POST', `/api/devices/${a.id}/slides`, { creation_id: c.id }) // concerne seulement A
  const { ms } = await waitingB
  assert.ok(ms >= 1800, `B attend son délai complet (${ms} ms)`)
})

test('fin de créneau : l’attente se termine pile quand la composition de la playlist change', async () => {
  const dev = await device(), a = await creation('lp4a', 30), b = await creation('lp4b', 220)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: a.id })
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: b.id, starts_at: iso(2) })
  const { body: first } = await current(dev)
  assert.equal(first.slide_count, 1)
  const { body, ms } = await current(dev, `?wait=20&v=${first.version}`)
  assert.ok(ms >= 1500 && ms < 4000, `réveillé au début du slide programmé (${ms} ms)`)
  assert.equal(body.slide_count, 2)
  assert.equal(body.settle_seconds, 0, 'changement prévu (fin de créneau) : le Pi dessine sans attendre')
})

test('l’écran rapporte ce qu’il affiche ; le dashboard le voit, et le voit en ligne', async () => {
  const dev = await device(), c = await creation('Mon slide', 77)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id })
  const { body } = await current(dev)
  await current(dev, `?shown=${body.hash}`)
  const listed = (await json('GET', '/api/devices')).find((d) => d.id === dev.id)
  assert.equal(listed.shown_hash, body.hash)
  assert.equal(listed.shown_name, 'Mon slide')
  assert.equal(listed.online, true)
  await current(dev, '?shown=pas-un-hash') // valeur invalide : ignorée
  assert.equal((await json('GET', '/api/devices')).find((d) => d.id === dev.id).shown_hash, body.hash)
})

test('un client qui raccroche en cours d’attente ne perturbe pas le serveur', async () => {
  const dev = await device()
  const { body: first } = await current(dev)
  const ctl = new AbortController()
  const pending = current(dev, `?wait=30&v=${first.version}`, ctl.signal).catch((e) => e.name)
  await sleep(150)
  ctl.abort()
  assert.equal(await pending, 'AbortError')
  const { status } = await current(dev)
  assert.equal(status, 200)
  assert.equal((await fetch(srv.base + '/api/health')).status, 200)
})
