// Marges du passe-partout : validation, empreinte, image finale composée, mire de calibrage.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { parseMargins, finalHash, isZero, canvasSize, calibrationSvg, calibrationImage, ZERO_MARGINS } from '../src/screen.js'
import { startServer } from './harness.js'

test('parseMargins : valeurs valides, complétées à partir des marges actuelles', () => {
  const r = parseMargins({ top: 10, left: 25 }, { ...ZERO_MARGINS, right: 5 }, 1200, 825)
  assert.deepEqual(r.value, { top: 10, right: 5, bottom: 0, left: 25 })
})

test('parseMargins : refuse négatif, décimal, trop grand, non numérique, et zone utile trop petite', () => {
  for (const bad of [{ top: -1 }, { top: 1.5 }, { top: 201 }, { top: '10' }, { top: null }]) {
    assert.ok(parseMargins(bad, ZERO_MARGINS, 1200, 825).error, JSON.stringify(bad))
  }
  assert.deepEqual(parseMargins({ top: 200, bottom: 200 }, ZERO_MARGINS, 1200, 825).value, { top: 200, right: 0, bottom: 200, left: 0 }, '425 px de hauteur utile : accepté')
  assert.ok(parseMargins({ left: 200, right: 200 }, ZERO_MARGINS, 600, 825).error, 'largeur utile 200 < 400')
  assert.ok(parseMargins(null, ZERO_MARGINS, 1200, 825).error)
})

test('canvas = écran moins les marges ; empreinte inchangée sans marge, différente sinon', () => {
  assert.deepEqual(canvasSize(1200, 825, { top: 10, right: 20, bottom: 30, left: 40 }), { width: 1140, height: 785 })
  assert.equal(finalHash('abc', ZERO_MARGINS), 'abc', 'compatibilité : sans marge, même empreinte qu’avant')
  const a = finalHash('abc', { ...ZERO_MARGINS, top: 5 }), b = finalHash('abc', { ...ZERO_MARGINS, top: 6 }), c = finalHash('abc', { ...ZERO_MARGINS, left: 5 })
  assert.equal(new Set(['abc', a, b, c]).size, 4, 'chaque marge compte, et chaque côté est distinct')
  assert.equal(isZero(ZERO_MARGINS), true)
})

test('mire : SVG valide, à la taille de l’écran, avec les cotes de la zone utile', async () => {
  const svg = calibrationSvg(1200, 825, { top: 10, right: 20, bottom: 30, left: 40 })
  assert.match(svg, /1140 × 785/)
  const meta = await sharp(Buffer.from(svg)).metadata()
  assert.equal(meta.width, 1200)
  assert.equal(meta.height, 825)
})

test('mire : marges, graduations et libellés exactement où il faut (haut 10, droite 0, bas 15, gauche 10)', async () => {
  const m = { top: 10, right: 0, bottom: 15, left: 10 }
  const png = await calibrationImage(1200, 825, m)
  const meta = await sharp(png).metadata()
  assert.deepEqual([meta.width, meta.height, meta.channels], [1200, 825, 1])
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const px = (x, y) => data[(y * info.width + x) * info.channels]

  // Marges noires et zone utile blanche, au pixel près (colonne x = 200 / ligne y = 200, hors règles et libellés).
  assert.equal(px(200, 9), 0, 'haut : y = 9 noir')
  assert.equal(px(200, 10), 255, 'haut : y = 10 blanc')
  assert.equal(px(200, 809), 255, 'bas : y = 809 blanc')
  assert.equal(px(200, 810), 0, 'bas : y = 810 noir')
  assert.equal(px(9, 200), 0, 'gauche : x = 9 noir')
  assert.equal(px(10, 200), 255, 'gauche : x = 10 blanc')
  assert.equal(px(1199, 200), 255, 'droite (0) : le dernier pixel est blanc')

  // Graduations mesurées depuis le bord RÉEL de la dalle, indépendantes des marges : la règle du haut est à x = 500..,
  // graduation d = 20 à y = 20 (noire, dans la zone utile) ; d = 5 à y = 5 (blanche, dans la marge noire de 10 px).
  assert.equal(px(510, 20), 0, 'graduation 20 du haut : noire sur blanc')
  assert.equal(px(510, 5), 255, 'graduation 5 du haut : blanche sur la marge noire')
  // Règle du bas : graduation d = 20 à y = 825 - 20 = 805 (zone utile, noire) ; d = 5 à y = 820 (marge de 15 : blanche).
  assert.equal(px(510, 805), 0, 'graduation 20 du bas : noire')
  assert.equal(px(510, 820), 255, 'graduation 5 du bas : blanche sur la marge noire')
  // Règle de gauche : graduation d = 5 (x = 5, marge de 10 : blanche) ; d = 20 (x = 20, zone utile : noire).
  assert.equal(px(5, 320), 255, 'graduation 5 de gauche : blanche sur la marge noire')
  assert.equal(px(20, 320), 0, 'graduation 20 de gauche : noire sur blanc')
})

test('mire : les libellés HAUT / BAS / GAUCHE / DROITE sont du bon côté de l’écran', () => {
  const svg = calibrationSvg(1200, 825, ZERO_MARGINS)
  const at = (word) => { const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${word}</text>`).exec(svg); assert.ok(m, `libellé ${word} présent`); return { x: +m[1], y: +m[2] } }
  assert.ok(at('HAUT').y < 825 / 2, 'HAUT dans la moitié haute')
  assert.ok(at('BAS').y > 825 / 2, 'BAS dans la moitié basse')
  assert.ok(at('GAUCHE').x < 1200 / 2, 'GAUCHE dans la moitié gauche')
  assert.ok(at('DROITE').x > 1200 / 2, 'DROITE dans la moitié droite')
})

// ---------- API : image finale réellement composée ----------
let srv
const admin = { Authorization: 'Bearer pw' }
const api = (method, path, body) => fetch(srv.base + path, { method, headers: { ...admin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
const json = async (...a) => (await api(...a)).json()
before(async () => { srv = await startServer({ ADMIN_PASSWORD: 'pw' }) })
after(() => srv?.stop())

const luminance = async (buf, x, y) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  return data[(y * info.width + x) * info.channels]
}
async function setup(shade) {
  const dev = await json('POST', '/api/devices', { name: 'm' })
  const c = await json('POST', '/api/creations', { name: 'c' })
  const png = (await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: shade, g: shade, b: shade } } }).png().toBuffer()).toString('base64')
  await api('PUT', `/api/creations/${c.id}`, { png: `data:image/png;base64,${png}` })
  await api('POST', `/api/devices/${dev.id}/slides`, { creation_id: c.id })
  const h = { Authorization: `Bearer ${dev.token}` }
  const cur = async () => (await fetch(`${srv.base}/api/device/current`, { headers: h })).json()
  const img = async (url) => Buffer.from(await (await fetch(srv.base + url, { headers: h })).arrayBuffer())
  return { dev, c, cur, img }
}

test('marges : validation par l’API, et canvas annoncé', async () => {
  assert.equal((await api('PUT', '/api/settings', { margins: { top: 500 } })).status, 400)
  assert.equal((await api('PUT', '/api/settings', { margins: { left: 200, right: 200, top: 200, bottom: 200 } })).status, 200, '425 × 425 utiles : accepté')
  const s = await json('PUT', '/api/settings', { margins: { top: 10, right: 20, bottom: 30, left: 40 } })
  assert.deepEqual(s.canvas, { width: 1140, height: 785 })
  assert.deepEqual(s.screen, { width: 1200, height: 825 })
  await json('PUT', '/api/settings', { margins: { top: 0, right: 0, bottom: 0, left: 0 } })
})

test('image finale : bordée de noir, slide centré dans la zone utile, taille de l’écran', async () => {
  const { cur, img } = await setup(200)
  const before = await cur()
  await json('PUT', '/api/settings', { margins: { top: 10, right: 20, bottom: 30, left: 40 } })
  const after = await cur()
  assert.notEqual(after.hash, before.hash, 'les marges changent l’empreinte : l’écran se met à jour')
  const png = await img(after.image_url)
  const meta = await sharp(png).metadata()
  assert.deepEqual([meta.width, meta.height, meta.channels], [1200, 825, 1], 'toujours 1200×825, niveaux de gris')
  assert.equal(await luminance(png, 5, 400), 0, 'marge gauche (40 px) noire')
  assert.equal(await luminance(png, 1190, 400), 0, 'marge droite (20 px) noire')
  assert.equal(await luminance(png, 600, 3), 0, 'marge haute (10 px) noire')
  assert.equal(await luminance(png, 600, 820), 0, 'marge basse (30 px) noire')
  assert.equal(await luminance(png, 600, 400), 200, 'le slide occupe la zone utile')
  // Frontières exactes (marges haut 10, droite 20, bas 30, gauche 40 sur 1200 × 825) : au pixel près.
  assert.equal(await luminance(png, 39, 400), 0, 'x = 39 : encore la marge gauche')
  assert.equal(await luminance(png, 40, 400), 200, 'x = 40 : premier pixel du slide')
  assert.equal(await luminance(png, 1179, 400), 200, 'x = 1179 : dernier pixel du slide')
  assert.equal(await luminance(png, 1180, 400), 0, 'x = 1180 : début de la marge droite')
  assert.equal(await luminance(png, 600, 9), 0, 'y = 9 : encore la marge haute')
  assert.equal(await luminance(png, 600, 10), 200, 'y = 10 : premier pixel du slide')
  assert.equal(await luminance(png, 600, 794), 200, 'y = 794 : dernier pixel du slide')
  assert.equal(await luminance(png, 600, 795), 0, 'y = 795 : début de la marge basse')
  await json('PUT', '/api/settings', { margins: { top: 0, right: 0, bottom: 0, left: 0 } })
  assert.equal((await cur()).hash, before.hash, 'marges remises à zéro : on retrouve l’empreinte d’origine')
})

test('le nom de ce que l’écran affiche reste trouvable avec des marges', async () => {
  const { dev, cur } = await setup(120)
  await json('PUT', '/api/settings', { margins: { top: 12, right: 12, bottom: 12, left: 12 } })
  const { hash } = await cur()
  await fetch(`${srv.base}/api/device/current?shown=${hash}`, { headers: { Authorization: `Bearer ${dev.token}` } })
  const listed = (await json('GET', '/api/devices')).find((d) => d.id === dev.id)
  assert.equal(listed.shown_name, 'c')
  await json('PUT', '/api/settings', { margins: { top: 0, right: 0, bottom: 0, left: 0 } })
})

test('mire : validation, image à la taille de l’écran, et extinction automatique qui réveille l’écran', async () => {
  const { dev, cur, img } = await setup(90)
  const normal = await cur()
  assert.equal((await api('POST', '/api/calibration', { on: true, seconds: 0 })).status, 400)
  assert.equal((await api('POST', '/api/calibration', { on: true, seconds: 99999 })).status, 400)
  await json('PUT', '/api/settings', { margins: { top: 8, right: 8, bottom: 8, left: 8 } })
  await json('POST', '/api/calibration', { on: true, seconds: 2 })
  const cal = await cur()
  assert.notEqual(cal.hash, normal.hash)
  assert.match(cal.image_url, /creation=calibration/)
  assert.equal(cal.slide_count, 0)
  const png = await img(cal.image_url)
  const meta = await sharp(png).metadata()
  assert.deepEqual([meta.width, meta.height], [1200, 825])
  assert.equal(await luminance(png, 2, 2), 0, 'marge noire')
  assert.equal(meta.channels, 1, 'mire en niveaux de gris, sans alpha')

  const t0 = Date.now()
  const back = await (await fetch(`${srv.base}/api/device/current?wait=20&v=${cal.version}`, { headers: { Authorization: `Bearer ${dev.token}` } })).json()
  assert.ok(Date.now() - t0 < 4500, `l’écran est réveillé à l’extinction de la mire (${Date.now() - t0} ms)`)
  assert.equal(back.slide_count, 1, 'retour au slide normal')
  assert.equal((await fetch(srv.base + cal.image_url, { headers: { Authorization: `Bearer ${dev.token}` } })).status, 404, 'plus de mire')
  await json('PUT', '/api/settings', { margins: { top: 0, right: 0, bottom: 0, left: 0 } })
})

test('mire : arrêt manuel', async () => {
  const { cur } = await setup(60)
  const normal = await cur()
  await json('POST', '/api/calibration', { on: true })
  assert.notEqual((await cur()).hash, normal.hash)
  await json('POST', '/api/calibration', { on: false })
  assert.equal((await cur()).hash, normal.hash)
})
