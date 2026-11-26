import sharp from 'sharp'
import { copyFile, readdir, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, ASSETS_DIR, CREATIONS_DIR } from './db.js'
import { TEMPLATES, MORE_TEMPLATES, W, H, makeBuilder } from './templates.js'

const BRAND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'brand', 'images')

// Idempotent : n'ajoute que ce qui manque, ne réécrit jamais un template déjà modifié.
export async function seedBrand(log = console) {
  const files = (await readdir(BRAND_DIR).catch(() => [])).filter((f) => f.endsWith('.png'))
  for (const f of files) {
    const key = basename(f, '.png')
    if (db.prepare('SELECT 1 FROM assets WHERE brand_key = ?').get(key)) continue
    const meta = await sharp(join(BRAND_DIR, f)).metadata()
    const info = db.prepare('INSERT INTO assets (filename, width, height, brand_key) VALUES (?, ?, ?, ?)').run(f, meta.width, meta.height, key)
    await copyFile(join(BRAND_DIR, f), join(ASSETS_DIR, `${info.lastInsertRowid}.png`))
    log.info(`brand: asset ${key} importé`)
  }

  const assets = Object.fromEntries(
    db.prepare('SELECT id, width, height, brand_key FROM assets WHERE brand_key IS NOT NULL').all().map((a) => [a.brand_key, a])
  )
  const sha = (x) => createHash('sha1').update(x).digest('hex')
  for (const t of [...TEMPLATES, ...MORE_TEMPLATES]) {
    const b = makeBuilder(assets)
    t.build(b)
    const scene = JSON.stringify({ width: W, height: H, background: '#ffffff', ...(b.fields.length ? { form: { fields: b.fields } } : {}), layers: b.layers })
    const hash = sha(scene)
    const row = db.prepare('SELECT id, scene, template_hash FROM creations WHERE template_key = ?').get(t.key)
    if (!row) {
      db.prepare('INSERT INTO creations (name, scene, is_template, template_key, template_hash) VALUES (?, ?, 1, ?, ?)').run(t.name, scene, t.key, hash)
      log.info(`brand: template ${t.key} créé`)
    } else if (row.template_hash !== hash && sha(row.scene) === (row.template_hash ?? sha(row.scene))) {
      // Template livré non modifié par l'utilisateur, mais la version du code a changé : on le met à jour
      // (aperçu invalidé, il sera régénéré par le dashboard). Un template retouché n'est jamais écrasé.
      db.prepare('UPDATE creations SET scene = ?, template_hash = ?, png_hash = NULL WHERE id = ?').run(scene, hash, row.id)
      await unlink(join(CREATIONS_DIR, `${row.id}.png`)).catch(() => {})
      log.info(`brand: template ${t.key} mis à jour`)
    }
  }
}
