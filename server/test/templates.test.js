// Cohérence des templates : champs, formats, polices, assets et bornes du canvas.
// Ces liens traversent plusieurs fichiers (templates.js, formats.js, fonts.js, styles.css, import-brand.mjs) :
// une faute de frappe y donne du texte vide ou une police de repli, sans aucune erreur.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { TEMPLATES, MORE_TEMPLATES, makeBuilder, W, H } from '../src/templates.js'
import { FORMATS, renderTemplate } from '../../admin/src/formats.js'
import { BRAND_FONTS, SYSTEM_FONTS } from '../../admin/src/fonts.js'
import { ROOT } from './harness.js'

const BRAND_DIR = join(ROOT, 'brand/images')
const assets = {}
let n = 0
for (const f of readdirSync(BRAND_DIR).filter((f) => f.endsWith('.png'))) {
  const { width, height } = await sharp(join(BRAND_DIR, f)).metadata()
  assets[basename(f, '.png')] = { id: ++n, width, height }
}
const FONT_FAMILIES = new Set([...BRAND_FONTS.map((f) => f.family), ...SYSTEM_FONTS])
const PLACEHOLDER = /\{(\w+)(?:\|(\w+))?\}/g
const ALL = [...TEMPLATES, ...MORE_TEMPLATES]

test('clés de templates uniques, au moins 14 templates', () => {
  const keys = ALL.map((t) => t.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(ALL.length >= 14)
})

for (const t of ALL) {
  test(`template « ${t.key} »`, () => {
    const b = makeBuilder(assets)
    t.build(b)
    const fields = b.fields
    const keys = fields.map((f) => f.key)
    assert.equal(new Set(keys).size, keys.length, 'clés de champs uniques')
    assert.equal(new Set(b.layers.map((l) => l.id)).size, b.layers.length, 'ids de calques uniques')

    for (const f of fields) {
      assert.ok(['text', 'textarea', 'date', 'time'].includes(f.type), `type de champ ${f.type}`)
      if (f.type === 'date') assert.match(f.value, /^\d{4}-\d{2}-\d{2}$/, `date ${f.key}`)
      if (f.type === 'time') assert.match(f.value, /^\d{2}:\d{2}$/, `heure ${f.key}`)
    }

    for (const l of b.layers) {
      const where = `calque ${l.id} (${l.type})`
      if (l.bind) {
        for (const [, key, fmt] of l.bind.tpl.matchAll(PLACEHOLDER)) {
          assert.ok(keys.includes(key), `${where} : champ inconnu « ${key} » dans ${l.bind.tpl}`)
          if (fmt) assert.ok(fmt in FORMATS, `${where} : format inconnu « ${fmt} » dans ${l.bind.tpl}`)
        }
        if (l.type === 'text') {
          assert.ok(renderTemplate(l.bind, fields).length > 0, `${where} : rendu vide pour ${l.bind.tpl}`)
          assert.ok(l.fit && l.fit.min <= l.fontSize, `${where} : fit incohérent`)
        }
      } else if (l.type === 'text') {
        assert.ok(l.text.length > 0, `${where} : texte vide sans liaison`)
      }
      if (l.type === 'text') assert.ok(FONT_FAMILIES.has(l.fontFamily), `${where} : police inconnue « ${l.fontFamily} »`)

      assert.ok(l.x >= 0 && l.y >= 0, `${where} : position négative`)
      assert.ok(l.x + l.width <= W, `${where} : dépasse à droite (${l.x + l.width} > ${W})`)
      if (l.type !== 'text') assert.ok(l.y + l.height <= H, `${where} : dépasse en bas (${l.y + l.height} > ${H})`)
    }
  })
}

test('polices : styles.css, fonts.js et import-brand.mjs concordent', () => {
  const css = readFileSync(join(ROOT, 'admin/src/styles.css'), 'utf8')
  const faces = [...css.matchAll(/@font-face\s*{\s*font-family:\s*'([^']+)';\s*src:\s*url\('\/fonts\/([^']+)'\)/g)]
  const cssFamilies = faces.map((m) => m[1]).sort()
  assert.deepEqual(cssFamilies, BRAND_FONTS.map((f) => f.family).sort(), '@font-face ↔ BRAND_FONTS')

  const script = readFileSync(join(ROOT, 'scripts/import-brand.mjs'), 'utf8')
  const imported = [...script.matchAll(/^\s*'([^']+\.(?:ttf|otf))':/gm)].map((m) => m[1]).sort()
  assert.deepEqual(faces.map((m) => m[2]).sort(), imported, 'fichiers référencés par styles.css ↔ import-brand.mjs')
})
