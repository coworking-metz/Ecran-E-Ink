import Konva from 'konva'
import { renderTemplate } from './formats.js'

// Mode formulaire : des champs (scene.form.fields) alimentent les calques texte liés (layer.bind = { tpl, upper }).
// tpl : texte avec {champ} ou {champ|format}. Formats : long, weekdayShort, day, time, des.
// Réduit la taille de police jusqu'à ce que le texte tienne en `fit.lines` lignes (mesure Konva, polices déjà chargées).
const fitSize = (l, text) => {
  const base = l.baseSize ?? l.fontSize
  if (!l.fit || !text) return base
  const t = new Konva.Text({ text, width: l.width, fontFamily: l.fontFamily, fontStyle: l.fontStyle || 'normal', lineHeight: l.lineHeight || 1.15 })
  let size = base
  for (; size > l.fit.min; size -= 2) {
    t.fontSize(size)
    if (t.height() <= l.fit.lines * size * (l.lineHeight || 1.15) + 1) break
  }
  return Math.max(size, Math.min(l.fit.min, base))
}

// Recalcule le texte de tous les calques liés. Sans formulaire, renvoie la scène telle quelle.
export const applyForm = (scene) => {
  if (!scene?.form?.fields?.length) return scene
  return {
    ...scene,
    layers: scene.layers.map((l) => {
      if (l.type === 'qr' && l.bind) return { ...l, value: renderTemplate({ ...l.bind, upper: false }, scene.form.fields) }
      if (l.type !== 'text' || !l.bind) return l
      const text = renderTemplate(l.bind, scene.form.fields)
      return { ...l, text, baseSize: l.baseSize ?? l.fontSize, fontSize: fitSize(l, text) }
    }),
  }
}
