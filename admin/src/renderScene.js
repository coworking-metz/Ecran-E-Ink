import Konva from 'konva'
import QRCode from 'qrcode'
import { loadBrandFonts } from './fonts.js'
import { textAttrs, rectAttrs, imageAttrs, assetUrl } from './sceneUtils.js'
import { applyForm } from './form.js'

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

// Rend une scène en PNG (data URL) à la taille native de l'écran, sans l'éditeur.
export const qrDataUrl = (value, size) =>
  QRCode.toDataURL(value || ' ', { margin: 1, width: Math.round(size), errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })

export async function renderScenePng(rawScene) {
  await loadBrandFonts()
  const scene = applyForm(rawScene) // après le chargement des polices : la mesure du texte en dépend
  const stage = new Konva.Stage({ container: document.createElement('div'), width: scene.width, height: scene.height })
  const layer = new Konva.Layer()
  stage.add(layer)
  layer.add(new Konva.Rect({ x: 0, y: 0, width: scene.width, height: scene.height, fill: scene.background }))
  for (const l of scene.layers) {
    if (l.type === 'text') layer.add(new Konva.Text(textAttrs(l)))
    else if (l.type === 'rect') layer.add(new Konva.Rect(rectAttrs(l)))
    else if (l.type === 'qr') layer.add(new Konva.Image({ ...imageAttrs(l), image: await loadImage(await qrDataUrl(l.value, l.width)) }))
    else if (l.type === 'image') layer.add(new Konva.Image({ ...imageAttrs(l), image: await loadImage(assetUrl(l.assetId)) }))
  }
  layer.draw()
  const data = stage.toDataURL({ pixelRatio: 1, mimeType: 'image/png' })
  stage.destroy()
  return data
}
