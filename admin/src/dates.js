// Dates des slides : le serveur stocke de l'ISO 8601 UTC, le dashboard saisit en heure locale (datetime-local).
const pad = (n) => String(n).padStart(2, '0')

export const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)
export const formatDate = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// État d'un slide à l'instant `now` : { key, label } ; `key` sert de classe CSS.
export function slideStatus(s, now = Date.now()) {
  if (!s.enabled) return { key: 'off', label: 'désactivé' }
  if (!s.png_hash) return { key: 'warn', label: 'à enregistrer (pas d’image)' }
  if (s.starts_at && Date.parse(s.starts_at) > now) return { key: 'soon', label: `dès le ${formatDate(s.starts_at)}` }
  if (s.ends_at && Date.parse(s.ends_at) <= now) return { key: 'done', label: `terminé le ${formatDate(s.ends_at)}` }
  return { key: 'on', label: s.ends_at ? `jusqu’au ${formatDate(s.ends_at)}` : 'actif' }
}

export const humanDuration = (seconds) => {
  if (seconds < 90) return `${seconds} s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${(seconds / 3600).toFixed(1).replace('.0', '')} h`
}
