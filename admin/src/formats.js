// Formats et rendu des gabarits du mode formulaire. Module pur (aucune dépendance navigateur) :
// importé par form.js (éditeur) et par les tests. Formats : long, weekdayShort, day, time, des.
const pad2 = (n) => String(n).padStart(2, '0')
const parseDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}
const fmtTime = (v) => {
  const m = /^(\d{2}):(\d{2})/.exec(v || '')
  return m ? `${+m[1]}h${m[2] === '00' ? '' : m[2]}` : ''
}
export const FORMATS = {
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

