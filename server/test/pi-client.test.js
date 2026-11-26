// Client du Pi (pi/client.py) contre le vrai serveur, avec un faux pilote d'écran : long-polling, regroupement des
// modifications rapprochées, rafraîchissement unique, arrêt rapide. Ignoré si Python ou Pillow manquent.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { startServer, ROOT } from './harness.js'

const pythonOk = spawnSync('python3', ['-c', 'import PIL']).status === 0
let srv, home, logFile, client
const admin = { Authorization: 'Bearer pw' }
const api = (method, path, body) => fetch(srv.base + path, { method, headers: { ...admin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
const json = async (...a) => (await api(...a)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lines = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean) : [])
const draws = () => lines().filter((l) => l.startsWith('draw'))
const clears = () => lines().filter((l) => l.startsWith('clear'))
const centre = (line) => Number(/centre=(\d+)/.exec(line)[1])
const at = (line) => Number(/t=([\d.]+)/.exec(line)[1])
async function until(cond, ms, what) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (cond()) return; await sleep(100) }
  assert.fail(`délai dépassé : ${what} (dessins : ${JSON.stringify(draws())})`)
}
async function setImage(id, shade) {
  const png = (await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: shade, g: shade, b: shade } } }).png().toBuffer()).toString('base64')
  await api('PUT', `/api/creations/${id}`, { png: `data:image/png;base64,${png}` })
}

before(async (t) => {
  if (!pythonOk) return t.skip('python3 + Pillow requis')
  srv = await startServer({ ADMIN_PASSWORD: 'pw' })
  home = mkdtempSync(join(tmpdir(), 'eink-pi-'))
  logFile = join(home, 'draws.log')
})
after(async () => {
  client?.kill('SIGKILL')
  await srv?.stop()
  if (home) rmSync(home, { recursive: true, force: true })
})

test('le client suit le dashboard en direct, regroupe les modifications rapprochées et s’arrête vite', { skip: !pythonOk && 'python3 + Pillow requis' }, async () => {
  const dev = await json('POST', '/api/devices', { name: 'pi' })
  const c = await json('POST', '/api/creations', { name: 'c' })
  await setImage(c.id, 60)
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id })
  writeFileSync(join(home, 'config.json'), JSON.stringify({ api_url: srv.base, token: dev.token, wait_seconds: 30, settle_seconds: 0.5, min_redraw_gap_seconds: 1.5 }))

  client = spawn('python3', ['pi/client.py'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, EINK_PI_HOME: home, PYTHONPATH: join(ROOT, 'pi/tests/fake'), EINK_FAKE_LOG: logFile },
    stdio: 'ignore',
  })

  await until(() => draws().length === 1, 8000, 'premier affichage')
  assert.equal(centre(draws()[0]), 60)

  // Le dashboard ré-enregistre l'image : l'écran la reçoit en direct (et non au prochain passage dans 30 s).
  const t0 = Date.now()
  await setImage(c.id, 200)
  await until(() => draws().length === 2, 8000, 'mise à jour en direct')
  assert.ok(Date.now() - t0 < 5000, `mise à jour en ${Date.now() - t0} ms`)
  assert.equal(centre(draws()[1]), 200)

  // Deux enregistrements très rapprochés, client au repos : le délai d'attente (settle) les regroupe en un seul
  // rafraîchissement avec la dernière version.
  await sleep(2000)
  await setImage(c.id, 100)
  await setImage(c.id, 150)
  await until(() => draws().length >= 3, 8000, 'rafraîchissement regroupé')
  await sleep(2500)
  assert.equal(draws().length, 3, `un seul rafraîchissement pour deux enregistrements : ${JSON.stringify(draws())}`)
  assert.equal(centre(draws()[2]), 150)

  // Délai minimal entre deux rafraîchissements (usure de la dalle) : un changement juste après un dessin attend.
  await setImage(c.id, 30)
  await until(() => draws().length === 4, 8000, 'rafraîchissement espacé')
  const spacing = at(draws()[3]) - at(draws()[2])
  assert.ok(spacing >= 1.4, `deux dessins espacés d'au moins 1,5 s (observé ${spacing.toFixed(2)} s)`)
  assert.equal(centre(draws()[3]), 30)

  // Des marges de passe-partout : l'écran se met à jour, avec un cadre noir (le coin devient noir, le centre inchangé).
  await api('PUT', '/api/settings', { margins: { top: 10, right: 10, bottom: 10, left: 10 } })
  await until(() => draws().length === 5, 8000, 'application des marges')
  assert.match(draws()[4], /coin=0/)
  assert.equal(centre(draws()[4]), 30)

  // Rafraîchissement forcé depuis le dashboard : l'écran est effacé puis redessiné, avec la MÊME image, et le Pi confirme.
  assert.equal(clears().length, 0, 'aucun effacement tant que rien n’est forcé (le premier passage adopte le compteur)')
  await api('POST', `/api/devices/${dev.id}/refresh`)
  await until(() => draws().length === 6, 8000, 'rafraîchissement forcé')
  assert.equal(clears().length, 1, 'écran effacé avant de redessiner')
  assert.equal(centre(draws()[5]), 30, 'même image qu’avant')
  assert.match(draws()[5], /coin=0/, 'marges toujours appliquées')
  for (let i = 0; i < 50; i++) { if (!(await json('GET', '/api/devices')).find((d) => d.id === dev.id).refresh_pending) break; await sleep(100) }
  assert.equal((await json('GET', '/api/devices')).find((d) => d.id === dev.id).refresh_pending, false, 'le Pi a confirmé')

  // Le dashboard voit ce que l'écran affiche, et le voit en ligne.
  const listed = (await json('GET', '/api/devices')).find((d) => d.id === dev.id)
  assert.equal(listed.online, true)
  assert.equal(listed.shown_name, 'c')

  // Arrêt (systemctl stop/restart) : le client est au milieu d'un long-polling de 30 s, il doit sortir tout de suite.
  const exited = new Promise((r) => client.once('exit', (code) => r(code)))
  const t1 = Date.now()
  client.kill('SIGTERM')
  assert.equal(await exited, 0)
  assert.ok(Date.now() - t1 < 3000, `arrêt en ${Date.now() - t1} ms`)
})
