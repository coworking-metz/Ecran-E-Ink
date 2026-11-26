// Ordonnancement des slides d'un écran. Fonction pure : le serveur décide quel slide afficher à l'instant T,
// le Pi n'a qu'à demander « qu'est-ce que je montre, et dans combien de temps je reviens ? ».
//
// Rotation : alignée sur l'horloge (époque Unix) et non sur un compteur mémorisé, donc sans état, identique pour
// tous les écrans, et qui survit aux redémarrages. Quand l'ensemble des slides actifs change, la phase se recale.

export const MIN_SLIDE_SECONDS = 30 // un rafraîchissement e-ink (16 gris) dure ~2 s avec flash : pas en dessous

const ms = (iso) => (iso ? Date.parse(iso) : null)

const durationMs = (i, defaultSeconds) => Math.max(MIN_SLIDE_SECONDS, i.duration_seconds ?? defaultSeconds) * 1000

// Slides diffusables à l'instant T, dans l'ordre de la playlist. Un slide sans image rendue (jamais enregistré) ne
// peut pas être affiché.
function activeAt(items, nowMs) {
  return items
    .filter((i) => i.enabled && i.png_hash)
    .filter((i) => (ms(i.starts_at) ?? -Infinity) <= nowMs && nowMs < (ms(i.ends_at) ?? Infinity))
    .sort((a, b) => a.position - b.position || a.id - b.id)
}

/**
 * @param items  [{ id, creation_id, position, duration_seconds, starts_at, ends_at, enabled, png_hash }]
 * @param nowMs  instant courant (ms)
 * @param defaultSeconds  durée par défaut d'un slide (options du dashboard)
 * @param offsetMs  décalage de phase de la rotation (voir `offsetToShow` : « afficher ce slide maintenant »)
 * @returns {{ item, activeCount, nextChangeMs }}
 *   item          slide à afficher (null si aucun n'est actif)
 *   nextChangeMs  durée avant que la réponse change (fin du créneau, début ou fin d'une période) ; Infinity si jamais
 */
export function schedule(items, nowMs, defaultSeconds, offsetMs = 0) {
  const usable = items.filter((i) => i.enabled && i.png_hash)
  const active = activeAt(items, nowMs)

  // Prochaine frontière de planning (début ou fin d'une période) : la composition de la playlist change à ce moment.
  let boundary = Infinity
  for (const i of usable) for (const t of [ms(i.starts_at), ms(i.ends_at)]) if (t != null && t > nowMs && t < boundary) boundary = t
  const untilBoundary = boundary - nowMs

  if (active.length === 0) return { item: null, activeCount: 0, nextChangeMs: untilBoundary }
  if (active.length === 1) return { item: active[0], activeCount: 1, nextChangeMs: untilBoundary }

  const total = active.reduce((s, i) => s + durationMs(i, defaultSeconds), 0)
  let pos = (((nowMs + offsetMs) % total) + total) % total
  for (const item of active) {
    const d = durationMs(item, defaultSeconds)
    if (pos < d) return { item, activeCount: active.length, nextChangeMs: Math.min(d - pos, untilBoundary) }
    pos -= d
  }
  /* inatteignable : pos < total */
  return { item: active[0], activeCount: active.length, nextChangeMs: untilBoundary }
}

// Délai de retour du Pi : la fin du créneau (+1 s de marge pour ne pas se réveiller juste avant), plafonné par
// `refreshSeconds` pour que les modifications faites dans le dashboard finissent toujours par arriver.
export function nextCheckSeconds(nextChangeMs, refreshSeconds) {
  const wait = Number.isFinite(nextChangeMs) ? Math.ceil(nextChangeMs / 1000) + 1 : Infinity
  return Math.max(5, Math.min(refreshSeconds, wait))
}

/**
 * « Afficher ce slide maintenant » : renvoie le décalage de phase à enregistrer pour que le slide commence à l'instant
 * T (la rotation continue ensuite normalement, avec les slides suivants dans l'ordre). null si le slide n'est pas
 * diffusable à cet instant (désactivé, hors période, sans image) ; 0 s'il est seul à tourner.
 */
export function offsetToShow(items, itemId, nowMs, defaultSeconds) {
  const active = activeAt(items, nowMs)
  const idx = active.findIndex((i) => i.id === itemId)
  if (idx < 0) return null
  if (active.length === 1) return 0
  const start = active.slice(0, idx).reduce((sum, i) => sum + durationMs(i, defaultSeconds), 0)
  const total = active.reduce((sum, i) => sum + durationMs(i, defaultSeconds), 0)
  return (((start - nowMs) % total) + total) % total
}
