// Mise à l'échelle des scènes vers le canvas réduit par les marges du passe-partout.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { fitScene } from '../../admin/src/sceneFit.js'
import { TEMPLATES, MORE_TEMPLATES, makeBuilder, W, H } from '../src/templates.js'
import { ROOT } from './harness.js'

const scene = (layers) => ({ width: 1200, height: 825, background: '#fff', layers })

test('canvas inchangé : la même scène est renvoyée (aucune dérive)', () => {
  const s = scene([{ id: 'a', type: 'rect', x: 10, y: 10, width: 100, height: 50, fill: '#000' }])
  assert.equal(fitScene(s, 1200, 825), s)
})

test('positions et largeurs proportionnelles ; texte à l’échelle uniforme ; QR reste carré', () => {
  const s = scene([
    { id: 't', type: 'text', x: 600, y: 400, width: 300, fontSize: 80, baseSize: 80, fit: { lines: 1, min: 40 }, text: 'x' },
    { id: 'q', type: 'qr', x: 100, y: 100, width: 300, height: 300, value: 'u' },
    { id: 'r', type: 'rect', x: 120, y: 82, width: 600, height: 165, fill: '#000' },
  ])
  const f = fitScene(s, 1000, 825) // moins large seulement : sx = 0,8333, sy = 1, s = 0,8333
  assert.deepEqual([f.width, f.height], [1000, 825])
  const [t, q, r] = f.layers
  assert.deepEqual([t.x, t.y, t.width], [500, 400, 250])
  assert.equal(t.fontSize, 67, 'échelle uniforme (la plus contraignante)')
  assert.equal(t.baseSize, 67)
  assert.equal(t.fit.min, 33)
  assert.equal(q.width, 250)
  assert.equal(q.height, 250, 'un QR code reste carré')
  assert.deepEqual([r.x, r.width, r.height], [100, 500, 165])
})

test('fond ou image plein cadre : couvre exactement le nouveau canvas', () => {
  const s = scene([
    { id: 'bg', type: 'rect', x: 0, y: 0, width: 1200, height: 825, fill: '#fff' },
    { id: 'img', type: 'image', assetId: 1, x: 0, y: 0, width: 1200, height: 825 },
  ])
  const f = fitScene(s, 1140, 785)
  for (const l of f.layers) assert.deepEqual([l.x, l.y, l.width, l.height], [0, 0, 1140, 785], l.id)
})

test('idempotent : ré-ajuster vers le même canvas ne change rien', () => {
  const s = scene([{ id: 'r', type: 'rect', x: 33, y: 71, width: 410, height: 99, fill: '#000' }])
  const once = fitScene(s, 1111, 777)
  assert.equal(fitScene(once, 1111, 777), once)
})

// Propriété sur les VRAIS templates : après ajustement à un canvas réduit, rien ne dépasse du canvas.
const BRAND_DIR = join(ROOT, 'brand/images')
const assets = {}
let n = 0
for (const f of readdirSync(BRAND_DIR).filter((f) => f.endsWith('.png'))) {
  const { width, height } = await sharp(join(BRAND_DIR, f)).metadata()
  assets[basename(f, '.png')] = { id: ++n, width, height }
}
for (const margins of [{ top: 10, right: 20, bottom: 30, left: 40 }, { top: 60, right: 60, bottom: 60, left: 60 }]) {
  const cw = W - margins.left - margins.right, ch = H - margins.top - margins.bottom
  test(`les ${TEMPLATES.length + MORE_TEMPLATES.length} templates tiennent dans un canvas ${cw} × ${ch}`, () => {
    for (const t of [...TEMPLATES, ...MORE_TEMPLATES]) {
      const b = makeBuilder(assets)
      t.build(b)
      const f = fitScene({ width: W, height: H, background: '#fff', layers: b.layers }, cw, ch)
      for (const l of f.layers) {
        const where = `${t.key}/${l.id} (${l.type})`
        assert.ok(l.x >= 0 && l.y >= 0, `${where} : position négative`)
        assert.ok(l.x + l.width <= cw + 1, `${where} : dépasse à droite (${l.x + l.width} > ${cw})`)
        if (l.type !== 'text') assert.ok(l.y + l.height <= ch + 1, `${where} : dépasse en bas (${l.y + l.height} > ${ch})`)
      }
    }
  })
}
