// Garde-fou « dépôt public » : refuse tout ce qui ne doit jamais être publié.
//   node scripts/check-public.mjs                 vérifie les fichiers suivis (CI, npm run check)
//   node scripts/check-public.mjs --range <rev>   vérifie les commits d'une plage (hook pre-push)
// Règles structurelles ci-dessous ; les chaînes propres à l'organisation (Wi-Fi, hôtes, identifiants…) vont dans
// `.public-denylist` (une par ligne, ignoré par git) : un fichier suivi les contiendrait justement.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const FORBIDDEN_PATHS = [
  [/\.(ttf|otf|woff2?|eot)$/i, 'fichier de police (copyright, pas de licence de redistribution)'],
  [/(^|\/)\.env(\.|$)(?!example)/, 'fichier .env'],
  [/(^|\/)CLAUDE\.local\.md$/, 'notes locales'],
  [/(^|\/)docs-local\//, 'notes locales'],
  [/\.(db|sqlite)(-wal|-shm)?$/, 'base de données'],
  [/(^|\/)server\/data\//, 'données du serveur'],
  [/\.(pem|key|p12)$/, 'clé ou certificat'],
]
const FORBIDDEN_CONTENT = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'jeton GitHub'],
  [/\b(?:SESSION_SECRET|ADMIN_PASSWORD)=[0-9a-f]{32,}\b/, 'secret en clair'],
  [/\/home\/[a-z][a-z0-9_-]*\//, 'chemin absolu de répertoire personnel'],
]
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip)$/i
const SELF = 'scripts/check-public.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const denylist = existsSync('.public-denylist')
  ? readFileSync('.public-denylist', 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  : []
const problems = []
const flag = (where, what) => problems.push(`  ${where} : ${what}`)

const scanPath = (path, where = path) => {
  for (const [re, why] of FORBIDDEN_PATHS) if (re.test(path)) flag(where, why)
}
const scanText = (text, where) => {
  for (const [re, why] of FORBIDDEN_CONTENT) if (re.test(text)) flag(where, why)
  const lower = text.toLowerCase()
  for (const s of denylist) if (lower.includes(s.toLowerCase())) flag(where, `chaîne interdite (.public-denylist) : « ${s} »`)
}

const rangeIdx = process.argv.indexOf('--range')
if (rangeIdx === -1) {
  for (const path of git('ls-files').split('\n').filter(Boolean)) {
    scanPath(path)
    if (path !== SELF && !BINARY.test(path) && existsSync(path)) scanText(readFileSync(path, 'utf8'), path)
  }
} else {
  let range = process.argv[rangeIdx + 1]
  try { git('rev-list', '--max-count=1', range) } catch { range = range.split('..').pop() } // base distante inconnue : tout l'historique
  for (const line of git('log', '--name-only', '--format=%h', range).split('\n')) {
    if (line && !/^[0-9a-f]{7,}$/.test(line)) scanPath(line, `historique : ${line}`)
  }
  let file = ''
  for (const line of git('log', '-p', '--format=', '--no-color', range).split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6)
    else if (line.startsWith('+') && file !== SELF && !BINARY.test(file)) scanText(line.slice(1), `historique : ${file}`)
  }
}

if (problems.length) {
  console.error(`✗ check-public : ${new Set(problems).size} problème(s) — ce dépôt est public, rien de tout cela ne doit y entrer :`)
  console.error([...new Set(problems)].join('\n'))
  process.exit(1)
}
console.log(`✓ check-public : rien d'interdit${denylist.length ? ` (${denylist.length} chaînes de .public-denylist vérifiées)` : ' (pas de .public-denylist local)'}`)
