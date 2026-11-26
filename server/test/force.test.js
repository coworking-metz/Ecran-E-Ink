// « Afficher ce slide maintenant » et « forcer le rafraîchissement » : API et réveil immédiat de l'écran.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { startServer } from './harness.js'

let srv
const admin = { Authorization: 'Bearer pw' }
const api = (method, path, body, headers = admin) =>
  fetch(srv.base + path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
const json = async (...a) => (await api(...a)).json()
const iso = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function creation(name, shade, withImage = true) {
  const c = await json('POST', '/api/creations', { name })
  if (withImage) {
    const png = (await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: shade, g: shade, b: shade } } }).png().toBuffer()).toString('base64')
    await api('PUT', `/api/creations/${c.id}`, { png: `data:image/png;base64,${png}` })
  }
  return json('GET', `/api/creations/${c.id}`)
}
const current = async (dev, query = '') => {
  const t0 = Date.now()
  const body = await (await fetch(`${srv.base}/api/device/current${query}`, { headers: { Authorization: `Bearer ${dev.token}` } })).json()
  return { body, ms: Date.now() - t0 }
}

before(async () => { srv = await startServer({ ADMIN_PASSWORD: 'pw' }) })
after(() => srv?.stop())

async function playlist(n = 3) {
  const dev = await json('POST', '/api/devices', { name: 'f' })
  const slides = []
  for (let i = 0; i < n; i++) {
    const c = await creation(`s${i}`, 40 + i * 70)
    const s = await json('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id, duration_seconds: 30 })
    slides.push({ ...s, hash: c.png_hash })
  }
  return { dev, slides }
}

test('afficher maintenant : le slide choisi est diffusé tout de suite, pour toute sa durée', async () => {
  const { dev, slides } = await playlist(3)
  for (const target of [slides[1], slides[2], slides[0], slides[1]]) {
    assert.equal((await api('POST', `/api/slides/${target.id}/show`)).status, 200)
    const { body } = await current(dev)
    assert.equal(body.hash, target.hash, `slide ${target.id} affiché`)
    assert.ok(body.next_check_seconds >= 28 && body.next_check_seconds <= 32, `créneau complet (${body.next_check_seconds} s)`)
  }
  await sleep(1200)
  assert.equal((await current(dev)).body.hash, slides[1].hash, 'il reste affiché pendant son créneau')
})

test('afficher maintenant : refusé si le slide n’est pas actif', async () => {
  const dev = await json('POST', '/api/devices', { name: 'g' })
  const ok = await creation('ok', 50), off = await creation('off', 90), old = await creation('old', 120), soon = await creation('soon', 150), noimg = await creation('noimg', 0, false)
  const add = (c, b = {}) => json('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id, ...b })
  const sOk = await add(ok), sOff = await add(off), sOld = await add(old, { ends_at: iso(-10) }), sSoon = await add(soon, { starts_at: iso(3600) }), sNo = await add(noimg)
  await api('PATCH', `/api/slides/${sOff.id}`, { enabled: false })
  for (const [label, s] of [['désactivé', sOff], ['terminé', sOld], ['à venir', sSoon], ['sans image', sNo]]) {
    const res = await api('POST', `/api/slides/${s.id}/show`)
    assert.equal(res.status, 409, label)
    assert.match((await res.json()).error, /pas actif/)
  }
  assert.equal((await api('POST', `/api/slides/${sOk.id}/show`)).status, 200)
  assert.equal((await api('POST', '/api/slides/99999/show')).status, 404)
  assert.equal((await api('POST', `/api/slides/${sOk.id}/show`, null, {})).status, 401, 'réservé à l’admin')
})

test('afficher maintenant : l’écran qui attend est réveillé aussitôt', async () => {
  const { dev, slides } = await playlist(2)
  const { body: first } = await current(dev)
  const other = first.hash === slides[0].hash ? slides[1] : slides[0]
  const waiting = current(dev, `?wait=20&v=${first.version}`)
  await sleep(150)
  await api('POST', `/api/slides/${other.id}/show`)
  const { body, ms } = await waiting
  assert.ok(ms < 2000, `réveillé en ${ms} ms`)
  assert.equal(body.hash, other.hash)
})

test('forcer le rafraîchissement : compteur, réveil immédiat, accusé de réception par le Pi', async () => {
  const { dev } = await playlist(1)
  const { body: first } = await current(dev)
  assert.equal(first.refresh_nonce, 0)
  const listed = async () => (await json('GET', '/api/devices')).find((d) => d.id === dev.id)
  assert.equal((await listed()).refresh_pending, false)

  const waiting = current(dev, `?wait=20&v=${first.version}`)
  await sleep(150)
  const res = await json('POST', `/api/devices/${dev.id}/refresh`)
  assert.equal(res.refresh_nonce, 1)
  const { body, ms } = await waiting
  assert.ok(ms < 2000, `réveillé en ${ms} ms`)
  assert.equal(body.refresh_nonce, 1)
  assert.equal(body.hash, first.hash, 'même image : seul le compteur change')
  assert.equal((await listed()).refresh_pending, true, 'en attente tant que le Pi n’a pas confirmé')

  await current(dev, '?nonce=1') // le Pi confirme
  assert.equal((await listed()).refresh_pending, false)
  assert.equal((await json('POST', `/api/devices/${dev.id}/refresh`)).refresh_nonce, 2)
  assert.equal((await listed()).refresh_pending, true)

  await current(dev, '?nonce=abc') // valeur invalide : ignorée
  assert.equal((await listed()).refresh_pending, true)
  await current(dev, '?nonce=0') // un ancien accusé ne fait pas reculer
  assert.equal((await listed()).refresh_pending, true)

  assert.equal((await api('POST', '/api/devices/99999/refresh')).status, 404)
  assert.equal((await api('POST', `/api/devices/${dev.id}/refresh`, null, {})).status, 401)
})
