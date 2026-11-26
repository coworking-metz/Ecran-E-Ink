// Démarre le vrai serveur sur un port libre avec une base jetable. Environnement minimal : rien du shell
// de l'utilisateur (PORT, WP_*, ADMIN_PASSWORD…) ne fuit dans les tests.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
    s.on('error', reject)
  })

export async function startServer(env = {}, { setup } = {}) {
  const port = await freePort()
  const dataDir = mkdtempSync(join(tmpdir(), 'eink-test-'))
  if (setup) await setup(dataDir) // ex. pré-remplir une base d'ancien schéma
  let log = ''
  const child = spawn(process.execPath, ['server/src/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, EINK_PORT: String(port), DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`le serveur s'est arrêté au démarrage :\n${log.slice(-1500)}`)
    try { if ((await fetch(`${base}/api/health`)).ok) break } catch {}
    if (Date.now() > deadline) { child.kill(); throw new Error(`le serveur ne répond pas :\n${log.slice(-1500)}`) }
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    port, base, dataDir, log: () => log,
    async stop() {
      child.kill('SIGTERM')
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)))
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}
