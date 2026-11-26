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

// Règles graduées depuis le bord RÉEL de la dalle (indépendantes des marges) : sur chaque côté, la graduation la plus
// proche du bord qui reste visible donne le nombre de pixels cachés par le passe-partout, c'est-à-dire la marge à saisir.
// Dessinées deux fois : en blanc (lisible sur les marges noires) et en noir, limitées à la zone utile (lisible sur le blanc).
export const RULER_MAX = 80 // px depuis le bord
export function calibrationSvg(screenW, screenH, m) {
  const c = canvasSize(screenW, screenH, m)
  const cx = screenW / 2, cy = screenH / 2
  const ticks = [], labels = []
  for (let d = 0; d <= RULER_MAX; d += 5) {
    const len = d % 10 === 0 ? 40 : 20
    ticks.push(
      `<path d="M${cx - 100} ${d}h${len}M${cx - 100} ${screenH - d}h${len}M${d} ${cy - 100}v${len}M${screenW - d} ${cy - 100}v${len}"/>`
    )
    if (d > 0 && d % 10 === 0) {
      // Étiquettes décalées pour ne jamais se toucher : 2 colonnes sur les règles horizontales (graduations espacées de
      // 10 px, chiffres de 13 px de haut), 4 rangées sur les règles verticales (chiffres plus larges que l'espacement).
      const col = (d / 10) % 2, row = (d / 10) % 4
      const tx = cx - 100 + 52 + col * 36
      const ty = cy - 100 + 50 + row * 17
      labels.push(
        `<text x="${tx}" y="${d + 5}">${d}</text>`,
        `<text x="${tx}" y="${screenH - d + 5}">${d}</text>`,
        `<text x="${d}" y="${ty}" text-anchor="middle">${d}</text>`,
        `<text x="${screenW - d}" y="${ty}" text-anchor="middle">${d}</text>`
      )
    }
  }
  const corner = (x, y, dx, dy) => `M${x + dx * 40} ${y}H${x}V${y + dy * 40}`
  const corners = [corner(m.left, m.top, 1, 1), corner(screenW - m.right, m.top, -1, 1), corner(m.left, screenH - m.bottom, 1, -1), corner(screenW - m.right, screenH - m.bottom, -1, -1)]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${screenW}" height="${screenH}" viewBox="0 0 ${screenW} ${screenH}">
  <defs>
    <clipPath id="inner"><rect x="${m.left}" y="${m.top}" width="${c.width}" height="${c.height}"/></clipPath>
    <g id="rulers" stroke="currentColor" stroke-width="2" fill="currentColor" font-family="sans-serif" font-size="13" font-weight="bold">
      ${ticks.join('\n      ')}
      ${labels.join('\n      ')}
    </g>
  </defs>
  <rect width="${screenW}" height="${screenH}" fill="#000"/>
  <rect x="${m.left}" y="${m.top}" width="${c.width}" height="${c.height}" fill="#fff"/>
  <path d="M${m.left} ${cy}H${screenW - m.right}M${cx} ${m.top}V${screenH - m.bottom}" stroke="#999" stroke-width="2" fill="none" clip-path="url(#inner)"/>
  <path d="${corners.join('')}" stroke="#000" stroke-width="4" fill="none"/>
  <use href="#rulers" color="#fff"/>
  <use href="#rulers" color="#000" clip-path="url(#inner)"/>
  <g font-family="sans-serif" font-weight="bold" font-size="30" fill="#000">
    <text x="${cx}" y="150" text-anchor="middle">HAUT</text>
    <text x="${cx}" y="${screenH - 130}" text-anchor="middle">BAS</text>
    <text x="150" y="${cy - 60}" text-anchor="start">GAUCHE</text>
    <text x="${screenW - 150}" y="${cy - 60}" text-anchor="end">DROITE</text>
  </g>
  <rect x="${cx - 270}" y="${cy - 70}" width="540" height="140" fill="#fff" stroke="#000" stroke-width="3"/>
  <text x="${cx}" y="${cy - 28}" font-family="sans-serif" font-size="26" font-weight="bold" text-anchor="middle" fill="#000">Lis le 1er chiffre visible sur chaque bord</text>
  <text x="${cx}" y="${cy + 6}" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#000">= la marge à saisir (px)</text>
  <text x="${cx}" y="${cy + 44}" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#000">réglé : haut ${m.top} · droite ${m.right} · bas ${m.bottom} · gauche ${m.left}  (${c.width} × ${c.height})</text>
</svg>`
}
export const calibrationHash = (screenW, screenH, m) => sha1(calibrationSvg(screenW, screenH, m))

export async function calibrationImage(screenW, screenH, m) {
  const svg = calibrationSvg(screenW, screenH, m)
  const key = `cal|${sha1(svg)}`
  if (cache.has(key)) return cache.get(key)
  return remember(key, await sharp(Buffer.from(svg)).flatten({ background: '#fff' }).removeAlpha().grayscale().toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer())
}
