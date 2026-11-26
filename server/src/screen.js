// Réglage « passe-partout » : marges noires autour de l'image affichée, identiques pour tous les slides.
// Les slides sont conçus sur un canvas réduit de ces marges ; le serveur les centre dans le cadre noir à la livraison,
// de sorte qu'un changement de marges s'applique à tous les slides immédiatement, sans les ré-enregistrer.
import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const SIDES = ['top', 'right', 'bottom', 'left']
export const MAX_MARGIN = 200
export const MIN_CANVAS = { width: 400, height: 300 }
export const ZERO_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 }

export const isZero = (m) => SIDES.every((s) => !m[s])
export const canvasSize = (screenW, screenH, m) => ({ width: screenW - m.left - m.right, height: screenH - m.top - m.bottom })

// Valide et complète (à partir de `current`) un objet de marges. Renvoie { value } ou { error }.
export function parseMargins(input, current, screenW, screenH) {
  if (typeof input !== 'object' || input === null) return { error: 'marges : un objet { top, right, bottom, left }' }
  const out = { ...current }
  for (const s of SIDES) {
    if (!(s in input)) continue
    const v = input[s]
    if (!Number.isInteger(v) || v < 0 || v > MAX_MARGIN) return { error: `marge ${s} : un entier entre 0 et ${MAX_MARGIN} px` }
    out[s] = v
  }
  const c = canvasSize(screenW, screenH, out)
  if (c.width < MIN_CANVAS.width || c.height < MIN_CANVAS.height) return { error: `zone utile trop petite (${c.width} × ${c.height}) : minimum ${MIN_CANVAS.width} × ${MIN_CANVAS.height}` }
  return { value: out }
}

const sha1 = (s) => createHash('sha1').update(s).digest('hex')

// Empreinte de l'image réellement envoyée à l'écran. Sans marges : celle de la création (compatibilité : les écrans
// déjà à jour ne retéléchargent rien). Avec marges : change dès qu'une marge change.
export const finalHash = (pngHash, m) => (isZero(m) ? pngHash : sha1(`${pngHash}|${SIDES.map((s) => m[s]).join(',')}`))

// Petit cache : quelques images finales (une par slide actif) évitent de recomposer à chaque téléchargement.
const cache = new Map()
const remember = (key, buf) => {
  cache.set(key, buf)
  if (cache.size > 24) cache.delete(cache.keys().next().value)
  return buf
}

// Image finale : la création (réduite à la zone utile si besoin) centrée dans un cadre noir de la taille de l'écran.
export async function composeFinal(rawPng, pngHash, m, screenW, screenH) {
  if (isZero(m)) return rawPng
  const key = `${finalHash(pngHash, m)}|${screenW}x${screenH}`
  if (cache.has(key)) return cache.get(key)
  const c = canvasSize(screenW, screenH, m)
  const inner = await sharp(rawPng).resize(c.width, c.height, { fit: 'fill' }).toBuffer()
  const out = await sharp({ create: { width: screenW, height: screenH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: inner, left: m.left, top: m.top }])
    .removeAlpha().grayscale().toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer()
  return remember(key, out)
}

// ---------- mire de calibrage ----------
// Affichée sur l'écran réel pour ajuster les marges à l'œil par rapport au passe-partout. Temporaire : elle s'éteint
// toute seule (état en mémoire : un redémarrage du serveur la désactive, ce qui est le comportement voulu).
let calibrationUntil = 0
export const calibrationStart = (seconds) => { calibrationUntil = Date.now() + seconds * 1000 }
export const calibrationStop = () => { calibrationUntil = 0 }
export const calibrationRemainingMs = (now = Date.now()) => Math.max(0, calibrationUntil - now)

export function calibrationSvg(screenW, screenH, m) {
  const c = canvasSize(screenW, screenH, m)
  const ticks = []
  for (let x = 0; x <= c.width; x += 10) {
    const len = x % 100 === 0 ? 44 : x % 50 === 0 ? 28 : 14
    ticks.push(`<path d="M${m.left + x} ${m.top}v${len}M${m.left + x} ${m.top + c.height}v${-len}" />`)
  }
  for (let y = 0; y <= c.height; y += 10) {
    const len = y % 100 === 0 ? 44 : y % 50 === 0 ? 28 : 14
    ticks.push(`<path d="M${m.left} ${m.top + y}h${len}M${m.left + c.width} ${m.top + y}h${-len}" />`)
  }
  const cx = m.left + c.width / 2, cy = m.top + c.height / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${screenW}" height="${screenH}" viewBox="0 0 ${screenW} ${screenH}">
  <rect width="${screenW}" height="${screenH}" fill="#000"/>
  <rect x="${m.left}" y="${m.top}" width="${c.width}" height="${c.height}" fill="#fff"/>
  <g stroke="#000" stroke-width="2" fill="none">
    <path d="M${m.left} ${m.top}L${m.left + c.width} ${m.top + c.height}M${m.left + c.width} ${m.top}L${m.left} ${m.top + c.height}" stroke="#888"/>
    <path d="M${cx} ${m.top}V${m.top + c.height}M${m.left} ${cy}H${m.left + c.width}" stroke="#888"/>
    ${ticks.join('\n    ')}
  </g>
  <rect x="${m.left + 3}" y="${m.top + 3}" width="${c.width - 6}" height="${c.height - 6}" fill="none" stroke="#000" stroke-width="6"/>
  <rect x="${cx - 250}" y="${cy - 70}" width="500" height="140" fill="#fff" stroke="#000" stroke-width="3"/>
  <text x="${cx}" y="${cy - 14}" font-family="sans-serif" font-size="40" font-weight="bold" text-anchor="middle" fill="#000">${c.width} × ${c.height}</text>
  <text x="${cx}" y="${cy + 38}" font-family="sans-serif" font-size="26" text-anchor="middle" fill="#000">haut ${m.top} · droite ${m.right} · bas ${m.bottom} · gauche ${m.left}</text>
</svg>`
}
export const calibrationHash = (screenW, screenH, m) => sha1(calibrationSvg(screenW, screenH, m))

export async function calibrationImage(screenW, screenH, m) {
  const svg = calibrationSvg(screenW, screenH, m)
  const key = `cal|${sha1(svg)}`
  if (cache.has(key)) return cache.get(key)
  return remember(key, await sharp(Buffer.from(svg)).flatten({ background: '#fff' }).removeAlpha().grayscale().toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer())
}
