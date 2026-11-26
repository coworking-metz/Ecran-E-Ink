import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import sharp from 'sharp'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile, unlink, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, CREATIONS_DIR, ASSETS_DIR } from './db.js'
import { seedBrand } from './brand.js'
import { registerAuth, sessionUser, SSO_ENABLED, SSO_PARTIAL } from './auth.js'

const PORT = Number(process.env.EINK_PORT || 3000)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'
const DEFAULT_W = 1200 // E Ink ED097TC2 (9.7")
const DEFAULT_H = 825

const app = Fastify({ logger: true, bodyLimit: 30 * 1024 * 1024 })
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

if (SSO_PARTIAL) app.log.warn('SSO WordPress incomplet : il faut WP_URL, WP_CLIENT_ID et SESSION_SECRET. Retour au mot de passe admin.')
if (SSO_ENABLED) app.log.info('SSO WordPress actif : la connexion par mot de passe est désactivée.')
else if (ADMIN_PASSWORD === 'admin') {
  app.log.warn('ADMIN_PASSWORD non défini : mot de passe par défaut "admin". Définis-le dans .env avant tout déploiement.')
}

// ---------- auth ----------
const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')

// Admin : session SSO (cookie signé). Le mot de passe n'est accepté que si le SSO n'est pas configuré (dev, premier démarrage).
const adminOnly = async (req, reply) => {
  if (sessionUser(req)) return
  if (!SSO_ENABLED && safeEqual(bearer(req), ADMIN_PASSWORD)) return
  reply.code(401).send({ error: 'unauthorized' })
}
const deviceOnly = async (req, reply) => {
  const device = db.prepare('SELECT * FROM devices WHERE token = ?').get(bearer(req))
  if (!device) return reply.code(401).send({ error: 'unauthorized' })
  req.device = device
}

registerAuth(app)

app.post('/api/login', async (req, reply) => {
  if (SSO_ENABLED) return reply.code(404).send({ error: 'login par mot de passe désactivé (SSO)' })
  if (!safeEqual(req.body?.password ?? '', ADMIN_PASSWORD)) return reply.code(401).send({ error: 'bad password' })
  return { ok: true }
})

// ---------- creations (admin) ----------
const creationRow = (r) => r && { ...r, scene: JSON.parse(r.scene) }
const pngPath = (id) => join(CREATIONS_DIR, `${id}.png`)

app.get('/api/creations', { preHandler: adminOnly }, async () =>
  db.prepare('SELECT id, name, png_hash, is_template, template_key, updated_at FROM creations ORDER BY is_template DESC, (CASE WHEN is_template = 1 THEN id END) ASC, updated_at DESC').all()
)

app.get('/api/creations/:id', { preHandler: adminOnly }, async (req, reply) => {
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id)
  return row ? creationRow(row) : reply.code(404).send({ error: 'not found' })
})

app.post('/api/creations', { preHandler: adminOnly }, async (req) => {
  const { name = 'Sans titre', scene, is_template = 0 } = req.body ?? {}
  const sc = scene ?? { width: DEFAULT_W, height: DEFAULT_H, background: '#ffffff', layers: [] }
  const info = db.prepare('INSERT INTO creations (name, scene, is_template) VALUES (?, ?, ?)').run(name, JSON.stringify(sc), is_template ? 1 : 0)
  return creationRow(db.prepare('SELECT * FROM creations WHERE id = ?').get(info.lastInsertRowid))
})

// png : data URL envoyé par l'éditeur (export Konva à la taille exacte de l'écran)
app.put('/api/creations/:id', { preHandler: adminOnly }, async (req, reply) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(id)
  if (!row) return reply.code(404).send({ error: 'not found' })
  const { name, scene, png, is_template } = req.body ?? {}
  let hash = row.png_hash
  if (png) {
    const raw = Buffer.from(String(png).replace(/^data:image\/\w+;base64,/, ''), 'base64')
    const w = scene?.width ?? JSON.parse(row.scene).width ?? DEFAULT_W
    const h = scene?.height ?? JSON.parse(row.scene).height ?? DEFAULT_H
    // Fond blanc forcé, niveaux de gris 8 bits, dimensions exactes de l'écran.
    const out = await sharp(raw)
      .flatten({ background: '#ffffff' })
      .resize(w, h, { fit: 'fill' })
      .grayscale()
      .toColourspace('b-w')
      .png({ compressionLevel: 9 })
      .toBuffer()
    await writeFile(pngPath(id), out)
    hash = createHash('sha1').update(out).digest('hex')
  }
  db.prepare("UPDATE creations SET name = ?, scene = ?, png_hash = ?, is_template = ?, updated_at = datetime('now') WHERE id = ?").run(
    name ?? row.name,
    scene ? JSON.stringify(scene) : row.scene,
    hash,
    is_template === undefined ? row.is_template : is_template ? 1 : 0,
    id
  )
  return creationRow(db.prepare('SELECT * FROM creations WHERE id = ?').get(id))
})

// Copie une création (ou un template) en nouvelle création éditable, image comprise.
app.post('/api/creations/:id/duplicate', { preHandler: adminOnly }, async (req, reply) => {
  const src = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id)
  if (!src) return reply.code(404).send({ error: 'not found' })
  const info = db
    .prepare('INSERT INTO creations (name, scene, png_hash, is_template) VALUES (?, ?, ?, 0)')
    .run(req.body?.name ?? (src.is_template ? src.name : `${src.name} (copie)`), src.scene, src.png_hash)
  if (existsSync(pngPath(src.id))) await copyFile(pngPath(src.id), pngPath(info.lastInsertRowid))
  return creationRow(db.prepare('SELECT * FROM creations WHERE id = ?').get(info.lastInsertRowid))
})

app.delete('/api/creations/:id', { preHandler: adminOnly }, async (req) => {
  db.prepare('DELETE FROM creations WHERE id = ?').run(req.params.id)
  await unlink(pngPath(req.params.id)).catch(() => {})
  return { ok: true }
})

app.get('/api/creations/:id/image', { preHandler: adminOnly }, async (req, reply) => {
  if (!existsSync(pngPath(req.params.id))) return reply.code(404).send({ error: 'no image' })
  return reply.type('image/png').send(await readFile(pngPath(req.params.id)))
})

// ---------- assets (images importées dans l'éditeur) ----------
app.get('/api/assets', { preHandler: adminOnly }, async () =>
  db.prepare('SELECT * FROM assets ORDER BY (brand_key IS NULL), id DESC').all()
)

app.post('/api/assets', { preHandler: adminOnly }, async (req, reply) => {
  const file = await req.file()
  if (!file) return reply.code(400).send({ error: 'no file' })
  const buf = await file.toBuffer()
  let out, meta
  try {
    // Normalise en PNG, 2400 px max (l'écran fait 1200 px de large).
    out = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    meta = await sharp(out).metadata()
  } catch {
    return reply.code(400).send({ error: 'unsupported image' })
  }
  const info = db
    .prepare('INSERT INTO assets (filename, width, height) VALUES (?, ?, ?)')
    .run(file.filename, meta.width, meta.height)
  await writeFile(join(ASSETS_DIR, `${info.lastInsertRowid}.png`), out)
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid)
})

app.delete('/api/assets/:id', { preHandler: adminOnly }, async (req, reply) => {
  const a = db.prepare('SELECT brand_key FROM assets WHERE id = ?').get(req.params.id)
  if (a?.brand_key) return reply.code(400).send({ error: 'les visuels de la charte ne se suppriment pas' })
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id)
  await unlink(join(ASSETS_DIR, `${Number(req.params.id)}.png`)).catch(() => {})
  return { ok: true }
})

// Les assets sont servis sans auth : ce sont des ressources de l'éditeur (ids non secrets mais non listés publiquement).
await app.register(fastifyStatic, { root: ASSETS_DIR, prefix: '/assets/', decorateReply: false })

// ---------- devices (admin) ----------
const newToken = () => randomBytes(24).toString('hex')

app.get('/api/devices', { preHandler: adminOnly }, async () =>
  db.prepare(`
    SELECT d.*, c.name AS creation_name, c.png_hash AS creation_hash
    FROM devices d LEFT JOIN creations c ON c.id = d.creation_id
    ORDER BY d.id
  `).all()
)

app.post('/api/devices', { preHandler: adminOnly }, async (req) => {
  const { name = 'Écran', width = DEFAULT_W, height = DEFAULT_H, refresh_seconds = 300 } = req.body ?? {}
  const info = db
    .prepare('INSERT INTO devices (name, token, width, height, refresh_seconds) VALUES (?, ?, ?, ?, ?)')
    .run(name, newToken(), width, height, refresh_seconds)
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid)
})

app.patch('/api/devices/:id', { preHandler: adminOnly }, async (req, reply) => {
  const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id)
  if (!d) return reply.code(404).send({ error: 'not found' })
  const b = req.body ?? {}
  db.prepare('UPDATE devices SET name = ?, refresh_seconds = ?, creation_id = ? WHERE id = ?').run(
    b.name ?? d.name,
    b.refresh_seconds ?? d.refresh_seconds,
    'creation_id' in b ? b.creation_id : d.creation_id,
    d.id
  )
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(d.id)
})

app.delete('/api/devices/:id', { preHandler: adminOnly }, async (req) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id)
  return { ok: true }
})

// ---------- API appelée par le Pi (token device) ----------
// Renvoie le hash de l'image à afficher ; le Pi ne télécharge l'image que si le hash a changé.
app.get('/api/device/current', { preHandler: deviceOnly }, async (req) => {
  const d = req.device
  db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(d.id)
  const c = d.creation_id ? db.prepare('SELECT id, png_hash FROM creations WHERE id = ?').get(d.creation_id) : null
  return {
    hash: c?.png_hash ?? null,
    image_url: c?.png_hash ? '/api/device/image' : null,
    width: d.width,
    height: d.height,
    refresh_seconds: d.refresh_seconds,
  }
})

app.get('/api/device/image', { preHandler: deviceOnly }, async (req, reply) => {
  const d = req.device
  if (!d.creation_id || !existsSync(pngPath(d.creation_id))) return reply.code(404).send({ error: 'no image' })
  return reply.type('image/png').send(await readFile(pngPath(d.creation_id)))
})

// ---------- dashboard (build Vite) ----------
const adminDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin', 'dist')
if (existsSync(adminDist)) {
  await app.register(fastifyStatic, { root: adminDist, prefix: '/', decorateReply: false })
}

app.get('/api/health', async () => ({ ok: true }))

await seedBrand(app.log)
await app.listen({ port: PORT, host: '0.0.0.0' })
