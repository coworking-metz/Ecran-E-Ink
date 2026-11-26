// Attributs Konva partagés entre l'éditeur (react-konva) et le rendu hors écran des aperçus.
export const textAttrs = (l) => ({
  id: l.id, text: l.text, x: l.x, y: l.y, width: l.width, rotation: l.rotation || 0,
  fontSize: l.fontSize, fontFamily: l.fontFamily, fontStyle: l.fontStyle || 'normal',
  fill: l.fill, align: l.align || 'left', lineHeight: l.lineHeight || 1.15, opacity: l.opacity ?? 1,
})
export const rectAttrs = (l) => ({
  id: l.id, x: l.x, y: l.y, width: l.width, height: l.height, rotation: l.rotation || 0,
  fill: l.fill, opacity: l.opacity ?? 1,
})
export const imageAttrs = (l) => ({
  id: l.id, x: l.x, y: l.y, width: l.width, height: l.height, rotation: l.rotation || 0, opacity: l.opacity ?? 1,
})
export const assetUrl = (id) => `/assets/${id}.png`
