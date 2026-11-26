import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import sharp from 'sharp'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile, unlink, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, CREATIONS_DIR, ASSETS_DIR, getSettings, setSetting } from './db.js'
import { schedule, nextCheckSeconds, offsetToShow, MIN_SLIDE_SECONDS } from './playlist.js'
import { notify, waitForChange, versionOf, reasonOf, URGENT_REASONS } from './hub.js'
import { parseMargins, canvasSize, finalHash, composeFinal, calibrationStart, calibrationStop, calibrationRemainingMs, calibrationHash, calibrationImage } from './screen.js'
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
  const sc = scene ?? { ...canvasSize(DEFAULT_W, DEFAULT_H, getSettings().margins), background: '#ffffff', layers: [] }
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
  if (png) notify(devicesUsing(id)) // l'image a changé : les écrans qui l'affichent se mettent à jour tout de suite
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
  const affected = devicesUsing(req.params.id)
  db.prepare('DELETE FROM creations WHERE id = ?').run(req.params.id)
  await unlink(pngPath(req.params.id)).catch(() => {})
  notify(affected)
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

const slidesOf = (deviceId) =>
  db.prepare(`
    SELECT p.*, c.name AS creation_name, c.png_hash
    FROM playlist_items p JOIN creations c ON c.id = p.creation_id
    WHERE p.device_id = ? ORDER BY p.position, p.id
  `).all(deviceId)

// Quel slide cet écran doit-il montrer maintenant ? (slide de repli des options si aucun n'est actif)
function resolveForDevice(device, nowMs = Date.now()) {
  const settings = getSettings()
  const items = slidesOf(device.id)
  const r = schedule(items, nowMs, settings.default_slide_seconds, device.phase_offset_ms || 0)
  const m = settings.margins
  // Mire de calibrage demandée depuis le dashboard : elle remplace tout, le temps du réglage.
  const cal = calibrationRemainingMs(nowMs)
  if (cal > 0) return { creationId: 'calibration', hash: calibrationHash(device.width, device.height, m), slideId: null, activeCount: 0, nextChangeMs: cal, items, settings }
  if (r.item) return { creationId: r.item.creation_id, hash: finalHash(r.item.png_hash, m), slideId: r.item.id, activeCount: r.activeCount, nextChangeMs: r.nextChangeMs, items, settings }
  const fb = settings.fallback_creation_id && db.prepare('SELECT id, png_hash FROM creations WHERE id = ?').get(settings.fallback_creation_id)
  return { creationId: fb?.png_hash ? fb.id : null, hash: fb?.png_hash ? finalHash(fb.png_hash, m) : null, slideId: null, activeCount: 0, nextChangeMs: r.nextChangeMs, items, settings }
}

// Écrans à prévenir quand une création change : ceux dont la playlist la contient (tous, si c'est le slide de repli).
const allDeviceIds = () => db.prepare('SELECT id FROM devices').all().map((r) => r.id)
const devicesUsing = (creationId) =>
  getSettings().fallback_creation_id === Number(creationId)
    ? allDeviceIds()
    : db.prepare('SELECT DISTINCT device_id FROM playlist_items WHERE creation_id = ?').all(creationId).map((r) => r.device_id)

// Nom de ce que l'écran affiche : on retrouve la création dont l'empreinte finale (avec marges) correspond.
function shownName(device, r) {
  if (!device.shown_hash) return null
  if (device.shown_hash === calibrationHash(device.width, device.height, r.settings.margins)) return 'mire de calibrage'
  const ids = new Set([...r.items.map((i) => i.creation_id), r.settings.fallback_creation_id].filter(Boolean))
  for (const id of ids) {
    const c = db.prepare('SELECT name, png_hash FROM creations WHERE id = ?').get(id)
    if (c?.png_hash && finalHash(c.png_hash, r.settings.margins) === device.shown_hash) return c.name
  }
  return null
}

const ONLINE_WITHIN_MS = 120_000 // le Pi interroge au moins toutes les ~50 s en long-polling
const seenAgo = (lastSeen) => (lastSeen ? Date.now() - Date.parse(lastSeen.replace(' ', 'T') + 'Z') : null)

app.get('/api/devices', { preHandler: adminOnly }, async () =>
  db.prepare('SELECT * FROM devices ORDER BY id').all().map((d) => {
    const r = resolveForDevice(d)
    const ago = seenAgo(d.last_seen)
    return {
      ...d,
      slides: r.items,
      current_slide_id: r.slideId,
      current_creation_id: r.creationId,
      online: ago !== null && ago < ONLINE_WITHIN_MS,
      refresh_pending: d.refresh_nonce > d.refreshed_nonce,
      seen_ago_seconds: ago === null ? null : Math.round(ago / 1000),
      shown_name: shownName(d, r),
    }
  })
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
  db.prepare('UPDATE devices SET name = ?, refresh_seconds = ? WHERE id = ?').run(b.name ?? d.name, b.refresh_seconds ?? d.refresh_seconds, d.id)
  notify([d.id])
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(d.id)
})

// Forcer le rafraîchissement : le Pi efface puis redessine l'écran en entier (rémanences), même si l'image n'a pas changé.
app.post('/api/devices/:id/refresh', { preHandler: adminOnly }, async (req, reply) => {
  const d = db.prepare('SELECT id FROM devices WHERE id = ?').get(req.params.id)
  if (!d) return reply.code(404).send({ error: 'écran introuvable' })
  db.prepare('UPDATE devices SET refresh_nonce = refresh_nonce + 1 WHERE id = ?').run(d.id)
  notify([d.id], 'refresh')
  return { ok: true, refresh_nonce: db.prepare('SELECT refresh_nonce FROM devices WHERE id = ?').get(d.id).refresh_nonce }
})

app.delete('/api/devices/:id', { preHandler: adminOnly }, async (req) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id)
  return { ok: true }
})

// ---------- playlist (admin) ----------
// Une date vide = pas de limite. Les dates sont stockées en ISO 8601 UTC ; le dashboard convertit depuis l'heure locale.
const parseDate = (v) => {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  const t = Date.parse(v)
  return Number.isNaN(t) ? { ok: false } : { ok: true, value: new Date(t).toISOString() }
}
function slideFields(b, current = {}) {
  const out = { duration_seconds: current.duration_seconds ?? null, starts_at: current.starts_at ?? null, ends_at: current.ends_at ?? null, enabled: current.enabled ?? 1 }
  if ('duration_seconds' in b) {
    const d = b.duration_seconds
    if (d === null || d === '') out.duration_seconds = null
    else if (Number.isInteger(d) && d >= MIN_SLIDE_SECONDS && d <= 86400) out.duration_seconds = d
    else return { error: `durée : un entier entre ${MIN_SLIDE_SECONDS} et 86400 secondes` }
  }
  for (const k of ['starts_at', 'ends_at']) {
    if (k in b) {
      const p = parseDate(b[k])
      if (!p.ok) return { error: `${k} : date invalide` }
      out[k] = p.value
    }
  }
  if (out.starts_at && out.ends_at && Date.parse(out.ends_at) <= Date.parse(out.starts_at)) return { error: 'la fin doit être après le début' }
  if ('enabled' in b) out.enabled = b.enabled ? 1 : 0
  return { value: out }
}

app.post('/api/devices/:id/slides', { preHandler: adminOnly }, async (req, reply) => {
  const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(req.params.id)
  const b = req.body ?? {}
  if (!device) return reply.code(404).send({ error: 'écran introuvable' })
  if (!db.prepare('SELECT 1 FROM creations WHERE id = ?').get(b.creation_id)) return reply.code(400).send({ error: 'création introuvable' })
  const f = slideFields(b)
  if (f.error) return reply.code(400).send({ error: f.error })
  const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM playlist_items WHERE device_id = ?').get(device.id).p
  const info = db
    .prepare('INSERT INTO playlist_items (device_id, creation_id, position, duration_seconds, starts_at, ends_at, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(device.id, b.creation_id, pos, f.value.duration_seconds, f.value.starts_at, f.value.ends_at, f.value.enabled)
  notify([device.id])
  return db.prepare('SELECT * FROM playlist_items WHERE id = ?').get(info.lastInsertRowid)
})

app.patch('/api/slides/:id', { preHandler: adminOnly }, async (req, reply) => {
  const cur = db.prepare('SELECT * FROM playlist_items WHERE id = ?').get(req.params.id)
  if (!cur) return reply.code(404).send({ error: 'slide introuvable' })
  const f = slideFields(req.body ?? {}, cur)
  if (f.error) return reply.code(400).send({ error: f.error })
  db.prepare('UPDATE playlist_items SET duration_seconds = ?, starts_at = ?, ends_at = ?, enabled = ? WHERE id = ?')
    .run(f.value.duration_seconds, f.value.starts_at, f.value.ends_at, f.value.enabled, cur.id)
  notify([cur.device_id])
  return db.prepare('SELECT * FROM playlist_items WHERE id = ?').get(cur.id)
})

// Afficher ce slide maintenant (s'il est actif) : on décale la phase de la rotation de l'écran pour qu'il commence tout de
// suite ; la rotation reprend ensuite normalement avec les slides suivants.
app.post('/api/slides/:id/show', { preHandler: adminOnly }, async (req, reply) => {
  const slide = db.prepare('SELECT * FROM playlist_items WHERE id = ?').get(req.params.id)
  if (!slide) return reply.code(404).send({ error: 'slide introuvable' })
  const offset = offsetToShow(slidesOf(slide.device_id), slide.id, Date.now(), getSettings().default_slide_seconds)
  if (offset === null) return reply.code(409).send({ error: "ce slide n'est pas actif en ce moment (désactivé, hors de sa période, ou sans image)" })
  db.prepare('UPDATE devices SET phase_offset_ms = ? WHERE id = ?').run(Math.round(offset), slide.device_id)
  notify([slide.device_id], 'show')
  return { ok: true }
})

app.delete('/api/slides/:id', { preHandler: adminOnly }, async (req) => {
  const row = db.prepare('SELECT device_id FROM playlist_items WHERE id = ?').get(req.params.id)
  db.prepare('DELETE FROM playlist_items WHERE id = ?').run(req.params.id)
  if (row) notify([row.device_id])
  return { ok: true }
})

// Corps : { ids: [id de slide, dans le nouvel ordre] } ; doit contenir exactement les slides de l'écran.
app.put('/api/devices/:id/slides/order', { preHandler: adminOnly }, async (req, reply) => {
  const have = db.prepare('SELECT id FROM playlist_items WHERE device_id = ?').all(req.params.id).map((r) => r.id).sort((a, b) => a - b)
  const ids = req.body?.ids
  if (!Array.isArray(ids) || JSON.stringify([...ids].sort((a, b) => a - b)) !== JSON.stringify(have)) {
    return reply.code(400).send({ error: "la liste doit contenir exactement les slides de l'écran" })
  }
  const upd = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
  ids.forEach((id, i) => upd.run(i, id))
  notify([Number(req.params.id)])
  return { ok: true }
})

// ---------- options du dashboard ----------
const settingsView = () => {
  const st = getSettings()
  return { ...st, canvas: canvasSize(DEFAULT_W, DEFAULT_H, st.margins), screen: { width: DEFAULT_W, height: DEFAULT_H }, calibration_seconds_left: Math.ceil(calibrationRemainingMs() / 1000) }
}
app.get('/api/settings', { preHandler: adminOnly }, async () => settingsView())

app.put('/api/settings', { preHandler: adminOnly }, async (req, reply) => {
  const b = req.body ?? {}
  if ('default_slide_seconds' in b) {
    const d = b.default_slide_seconds
    if (!Number.isInteger(d) || d < MIN_SLIDE_SECONDS || d > 86400) return reply.code(400).send({ error: `durée par défaut : un entier entre ${MIN_SLIDE_SECONDS} et 86400 secondes` })
    setSetting('default_slide_seconds', d)
  }
  if ('fallback_creation_id' in b) {
    const id = b.fallback_creation_id
    if (id !== null && !db.prepare('SELECT 1 FROM creations WHERE id = ?').get(id)) return reply.code(400).send({ error: 'création de repli introuvable' })
    setSetting('fallback_creation_id', id)
  }
  if ('margins' in b) {
    const m = parseMargins(b.margins, getSettings().margins, DEFAULT_W, DEFAULT_H)
    if (m.error) return reply.code(400).send({ error: m.error })
    setSetting('margins', m.value)
  }
  notify(allDeviceIds(), 'margins' in b ? 'margins' : 'edit')
  return settingsView()
})

// Mire de calibrage sur les écrans (réglage des marges à l'œil). Temporaire : s'éteint seule.
app.post('/api/calibration', { preHandler: adminOnly }, async (req, reply) => {
  const { on, seconds = 900 } = req.body ?? {}
  if (on) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) return reply.code(400).send({ error: 'durée : de 1 à 3600 secondes' })
    calibrationStart(seconds)
  } else calibrationStop()
  notify(allDeviceIds(), 'calibration')
  return settingsView()
})

// ---------- API appelée par le Pi (token device) ----------
// Le serveur choisit le slide du moment. Le Pi ne télécharge l'image que si le hash a changé.
// Long-polling : avec `?wait=<s>&v=<version>`, la réponse est retenue jusqu'à un changement envoyé par le dashboard,
// la fin du créneau du slide, ou `wait` secondes (45 max : Cloudflare coupe à 100 s). Sans `v` (ou avec une version
// périmée, ex. après un redémarrage du serveur) on répond tout de suite. `shown=<hash>` : ce que l'écran affiche.
// Les anciens clients, qui ignorent `wait`, continuent de s'appuyer sur `next_check_seconds`.
const MAX_WAIT_SECONDS = 45
app.get('/api/device/current', { preHandler: deviceOnly }, async (req, reply) => {
  const touch = (id, shown) => {
    db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(id)
    if (shown) db.prepare("UPDATE devices SET shown_hash = ?, shown_at = datetime('now') WHERE id = ? AND COALESCE(shown_hash, '') != ?").run(shown, id, shown)
  }
  const shown = typeof req.query?.shown === 'string' && /^[0-9a-f]{40}$/.test(req.query.shown) ? req.query.shown : null
  const id = req.device.id
  touch(id, shown)
  // Le Pi confirme le dernier « rafraîchissement forcé » pris en compte : le dashboard sait s'il est fait.
  const nonce = /^\d{1,9}$/.test(String(req.query?.nonce ?? '')) ? Number(req.query.nonce) : null
  if (nonce !== null) db.prepare('UPDATE devices SET refreshed_nonce = MAX(refreshed_nonce, ?) WHERE id = ?').run(nonce, id)

  let r = resolveForDevice(req.device)
  let woke = 'immediate' // pourquoi cette réponse part maintenant
  const wait = Math.min(MAX_WAIT_SECONDS, Number(req.query?.wait) || 0)
  const known = typeof req.query?.v === 'string' ? req.query.v : null
  if (wait > 0 && known === versionOf(id)) {
    const slotMs = Number.isFinite(r.nextChangeMs) ? r.nextChangeMs + 100 : Infinity
    woke = await waitForChange(id, known, Math.min(wait * 1000, slotMs), reply.raw)
    if (reply.raw.destroyed) return reply // client parti : rien à renvoyer
    const fresh = db.prepare('SELECT * FROM devices WHERE id = ?').get(id)
    if (!fresh) return reply.code(401).send({ error: 'unauthorized' })
    touch(id, null)
    req.device = fresh
    r = resolveForDevice(fresh)
  }
  const d = req.device
  return {
    hash: r.hash,
    image_url: r.hash ? `/api/device/image?creation=${r.creationId}` : null,
    width: d.width,
    height: d.height,
    refresh_seconds: d.refresh_seconds,
    next_check_seconds: nextCheckSeconds(r.nextChangeMs, d.refresh_seconds),
    slide_id: r.slideId,
    slide_count: r.activeCount,
    version: versionOf(id),
    refresh_nonce: d.refresh_nonce,
    // Délai de regroupement conseillé au Pi avant de dessiner : 0 pour une action explicite (afficher maintenant,
    // rafraîchir, calibrage) et pour la rotation prévue (fin de créneau) ; court pour les enregistrements, que le Pi
    // regroupe quand ils se suivent.
    settle_seconds: woke === 'timeout' || URGENT_REASONS.has(reasonOf(id)) ? 0 : 0.8,
  }
})

// L'image demandée doit appartenir à la playlist de l'écran (ou être le slide de repli) : un jeton d'écran
// ne donne pas accès aux autres créations.
app.get('/api/device/image', { preHandler: deviceOnly }, async (req, reply) => {
  const d = req.device
  const r = resolveForDevice(d)
  const m = r.settings.margins
  if (req.query?.creation === 'calibration') {
    if (calibrationRemainingMs() <= 0) return reply.code(404).send({ error: 'no image' })
    return reply.type('image/png').send(await calibrationImage(d.width, d.height, m))
  }
  const wanted = req.query?.creation ? Number(req.query.creation) : r.creationId
  const allowed = new Set([...r.items.map((i) => i.creation_id), r.settings.fallback_creation_id].filter(Boolean))
  if (!wanted || !allowed.has(wanted) || !existsSync(pngPath(wanted))) return reply.code(404).send({ error: 'no image' })
  const png_hash = db.prepare('SELECT png_hash FROM creations WHERE id = ?').get(wanted)?.png_hash
  return reply.type('image/png').send(await composeFinal(await readFile(pngPath(wanted)), png_hash, m, d.width, d.height))
})

// ---------- dashboard (build Vite) ----------
const adminDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin', 'dist')
if (existsSync(adminDist)) {
  await app.register(fastifyStatic, { root: adminDist, prefix: '/', decorateReply: false })
}

app.get('/api/health', async () => ({ ok: true }))

await seedBrand(app.log)
// Boucle locale par défaut : en production seul le reverse proxy (Apache) doit joindre l'app.
await app.listen({ port: PORT, host: process.env.EINK_HOST || '127.0.0.1' })
