// Contrat de base du serveur : dashboard servi, API protégée, templates semés, contrat du Pi, écoute locale seulement.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { startServer, ROOT } from './harness.js'

let srv
const auth = { Authorization: 'Bearer test-password' }
const api = (method, path, body, headers = auth) =>
  fetch(srv.base + path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })

before(async () => { srv = await startServer({ ADMIN_PASSWORD: 'test-password' }) })
after(() => srv?.stop())

test('le dashboard et son bundle JS sont servis (régression : collision /assets/)', { skip: !existsSync(join(ROOT, 'admin/dist/index.html')) && 'admin/dist absent : lancer npm run build' }, async () => {
  const res = await fetch(srv.base + '/')
  assert.equal(res.status, 200)
  const html = await res.text()
  const js = /<script[^>]+src="([^"]+)"/.exec(html)?.[1]
  assert.ok(js, 'index.html référence un script')
  const jsRes = await fetch(srv.base + js)
  assert.equal(jsRes.status, 200, `le bundle ${js} doit être servi`)
  assert.match(jsRes.headers.get('content-type'), /javascript/)
})

test("l'API admin exige une authentification", async () => {
  assert.equal((await api('GET', '/api/creations', null, {})).status, 401)
  assert.equal((await api('GET', '/api/creations', null, { Authorization: 'Bearer faux' })).status, 401)
  assert.equal((await api('GET', '/api/creations')).status, 200)
})

test('les 14 templates sont semés, et la duplication donne une création éditable', async () => {
  const list = await (await api('GET', '/api/creations')).json()
  const templates = list.filter((c) => c.is_template)
  assert.ok(templates.length >= 14, `templates : ${templates.length}`)
  const copy = await (await api('POST', `/api/creations/${templates[0].id}/duplicate`, {})).json()
  assert.equal(copy.is_template, 0)
  assert.ok(copy.scene.layers.length > 0)
})

test("contrat du Pi : l'image publiée est un PNG en niveaux de gris à la taille de l'écran", async () => {
  const dev = await (await api('POST', '/api/devices', { name: 'test' })).json()
  const c = await (await api('POST', '/api/creations', { name: 'x' })).json()
  const png = (await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c03030' } }).png().toBuffer()).toString('base64')
  await api('PUT', `/api/creations/${c.id}`, { png: `data:image/png;base64,${png}` })
  await api('PATCH', `/api/devices/${dev.id}`, { creation_id: c.id })
  const devAuth = { Authorization: `Bearer ${dev.token}` }

  const cur = await (await fetch(srv.base + '/api/device/current', { headers: devAuth })).json()
  assert.match(cur.hash, /^[0-9a-f]{40}$/)
  assert.equal(cur.image_url, '/api/device/image')

  const buf = Buffer.from(await (await fetch(srv.base + cur.image_url, { headers: devAuth })).arrayBuffer())
  assert.equal(buf.readUInt32BE(16), 1200, 'largeur')
  assert.equal(buf.readUInt32BE(20), 825, 'hauteur')
  assert.equal(buf[24], 8, 'profondeur 8 bits')
  assert.equal(buf[25], 0, 'type de couleur 0 = niveaux de gris')

  assert.equal((await fetch(srv.base + '/api/device/current', { headers: { Authorization: 'Bearer nope' } })).status, 401)
})

test("écoute sur la boucle locale seulement (régression : 0.0.0.0 exposait le port en HTTP clair)", async (t) => {
  const ext = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
  if (!ext) return t.skip("aucune interface réseau externe pour tester")
  await assert.rejects(fetch(`http://${ext.address}:${srv.port}/api/health`, { signal: AbortSignal.timeout(3000) }), 'le port ne doit pas répondre sur ' + ext.address)
})
