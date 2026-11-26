import Konva from 'konva'

// Mode formulaire : des champs (scene.form.fields) alimentent les calques texte liés (layer.bind = { tpl, upper }).
// tpl : texte avec {champ} ou {champ|format}. Formats : long, weekdayShort, day, time, des.
const pad2 = (n) => String(n).padStart(2, '0')
const parseDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}
const fmtTime = (v) => {
  const m = /^(\d{2}):(\d{2})/.exec(v || '')
  return m ? `${+m[1]}h${m[2] === '00' ? '' : m[2]}` : ''
}
const FORMATS = {
  long: (v) => parseDate(v)?.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) ?? '', // jeudi 3 décembre
  weekdayShort: (v) => parseDate(v)?.toLocaleDateString('fr-FR', { weekday: 'short' }) ?? '', // jeu.
  day: (v) => { const d = parseDate(v); return d ? pad2(d.getDate()) : '' }, // 03
  time: fmtTime, // 9h30
  des: (v) => { const t = fmtTime(v); return t ? `dès ${t}` : '' }, // dès 9h30
}

export const renderTemplate = (bind, fields) => {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value ?? '']))
  const out = bind.tpl
    .replace(/\{(\w+)(?:\|(\w+))?\}/g, (_, key, fmt) => (fmt ? FORMATS[fmt]?.(byKey[key]) ?? '' : byKey[key] ?? ''))
    .trim()
  return bind.upper ? out.toLocaleUpperCase('fr-FR') : out
}

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
