// Capture d'écran du dashboard : démarre un serveur jetable (base vide, mot de passe de test), pilote Chrome sans
// interface (CDP), enregistre une PNG puis nettoie tout. Sert à VOIR l'interface sans navigateur ouvert.
//   node scripts/screenshot.mjs <route> <sortie.png> [--wait 4000] [--size 1500x900] [--seed demo] [--copy-previews <dossier>]
//   exemples de routes : /creations   /devices   /settings   /editor/3
// --seed demo          crée un écran avec une playlist d'exemple (slides actifs, à venir, terminé, désactivé)
// --copy-previews dir  copie les PNG des templates générées par la page Créations (attendre assez longtemps)
// Chrome : variable CHROME, sinon google-chrome / chromium détectés dans le PATH. Build préalable : npm run build.
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { startServer, ROOT } from '../server/test/harness.js'

const argv = process.argv.slice(2)
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i === -1 ? def : argv[i + 1] }
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] ?? '').startsWith('--'))
const [route = '/creations', out = 'screenshot.png'] = positional
const [width, height] = opt('size', '1500x900').split('x').map(Number)
const waitMs = Number(opt('wait', 4000))

if (!existsSync(join(ROOT, 'admin/dist/index.html'))) { console.error('admin/dist absent : lancer npm run build'); process.exit(1) }
const chromeBin = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser'].find((b) => { try { execFileSync('which', [b], { stdio: 'ignore' }); return true } catch { return false } })
if (!chromeBin) { console.error('Chrome/Chromium introuvable (variable CHROME)'); process.exit(1) }

const PASSWORD = 'screenshot'
const auth = { Authorization: `Bearer ${PASSWORD}`, 'Content-Type': 'application/json' }

const seeds = {
  async demo(base) {
    const api = async (method, path, body) => (await fetch(base + path, { method, headers: auth, body: body ? JSON.stringify(body) : undefined })).json()
    const mk = async (name, shade) => {
      const c = await api('POST', '/api/creations', { name })
      const png = (await sharp({ create: { width: 60, height: 41, channels: 3, background: { r: shade, g: shade, b: shade } } }).png().toBuffer()).toString('base64')
      await api('PUT', `/api/creations/${c.id}`, { png: `data:image/png;base64,${png}` })
      return c
    }
    const dev = await api('POST', '/api/devices', { name: 'Écran principal' })
    const iso = (days) => new Date(Date.now() + days * 86400_000).toISOString()
    const [a, b, c, d, e] = await Promise.all([mk('Accueil — Bienvenue', 60), mk('Petit déjeuner du coworking', 130), mk('BBQ du coworking', 190), mk('Offre de Noël', 100), mk('Ancienne annonce', 220)])
    await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: a.id })
    await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: b.id, duration_seconds: 90 })
    await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id, starts_at: iso(20), ends_at: iso(21) })
    await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: d.id, ends_at: iso(30) })
    const old = await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: e.id, ends_at: iso(-3) })
    await api('PATCH', `/api/slides/${old.id}`, { enabled: false })
    await api('PUT', '/api/settings', { fallback_creation_id: a.id })
  },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const srv = await startServer({ ADMIN_PASSWORD: PASSWORD })
const profile = mkdtempSync(join(tmpdir(), 'eink-chrome-'))
const debugPort = 9300 + Math.floor(Math.random() * 500)
let chrome
try {
  const seed = opt('seed')
  if (seed) await seeds[seed](srv.base)

  chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' })
  let tab
  for (let i = 0; i < 60 && !tab; i++) { try { tab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json() } catch { await sleep(250) } }
  if (!tab) throw new Error('Chrome ne répond pas')

  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let nextId = 0; const pending = new Map(); const consoleLogs = []
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d.error); pending.delete(d.id) }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) consoleLogs.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`)
    if (d.method === 'Runtime.exceptionThrown') consoleLogs.push(`exception: ${d.params.exceptionDetails.exception?.description}`)
  }
  const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: srv.base + '/' })
  await sleep(1200)
  await send('Runtime.evaluate', { expression: `localStorage.setItem('eink_admin_password', '${PASSWORD}')` })
  // Query différente = vraie navigation (et non simple changement de hash) : l'app repart de zéro, connectée.
  await send('Page.navigate', { url: `${srv.base}/?capture=1#${route}` })
  await sleep(waitMs)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`capture : ${out} (${width}x${height}, route ${route})`)

  const previews = opt('copy-previews')
  if (previews) {
    mkdirSync(previews, { recursive: true })
    const dir = join(srv.dataDir, 'creations')
    const files = existsSync(dir) ? readdirSync(dir) : []
    for (const f of files) cpSync(join(dir, f), join(previews, f))
    console.log(`${files.length} aperçu(s) copié(s) dans ${previews}`)
  }
  console.log(consoleLogs.length ? `console navigateur :\n  ${consoleLogs.slice(0, 10).join('\n  ')}` : 'console navigateur : aucune erreur')
  ws.close()
} finally {
  if (chrome) {
    chrome.kill()
    await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(3000)]) // Chrome écrit encore dans son profil
  }
  await srv.stop()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
