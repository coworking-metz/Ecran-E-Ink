// Ordonnancement des slides d'un écran. Fonction pure : le serveur décide quel slide afficher à l'instant T,
// le Pi n'a qu'à demander « qu'est-ce que je montre, et dans combien de temps je reviens ? ».
//
// Rotation : alignée sur l'horloge (époque Unix) et non sur un compteur mémorisé, donc sans état, identique pour
// tous les écrans, et qui survit aux redémarrages. Quand l'ensemble des slides actifs change, la phase se recale.

export const MIN_SLIDE_SECONDS = 30 // un rafraîchissement e-ink (16 gris) dure ~2 s avec flash : pas en dessous

const ms = (iso) => (iso ? Date.parse(iso) : null)

/**
 * @param items  [{ id, creation_id, position, duration_seconds, starts_at, ends_at, enabled, png_hash }]
 * @param nowMs  instant courant (ms)
 * @param defaultSeconds  durée par défaut d'un slide (options du dashboard)
 * @returns {{ item, activeCount, nextChangeMs }}
 *   item          slide à afficher (null si aucun n'est actif)
 *   nextChangeMs  durée avant que la réponse change (fin du créneau, début ou fin d'une période) ; Infinity si jamais
 */
export function schedule(items, nowMs, defaultSeconds) {
  // Un slide sans image rendue (jamais enregistré) ne peut pas être affiché.
  const usable = items.filter((i) => i.enabled && i.png_hash)
  const active = usable
    .filter((i) => (ms(i.starts_at) ?? -Infinity) <= nowMs && nowMs < (ms(i.ends_at) ?? Infinity))
    .sort((a, b) => a.position - b.position || a.id - b.id)

  // Prochaine frontière de planning (début ou fin d'une période) : la composition de la playlist change à ce moment.
  let boundary = Infinity
  for (const i of usable) for (const t of [ms(i.starts_at), ms(i.ends_at)]) if (t != null && t > nowMs && t < boundary) boundary = t
  const untilBoundary = boundary - nowMs

  if (active.length === 0) return { item: null, activeCount: 0, nextChangeMs: untilBoundary }
  if (active.length === 1) return { item: active[0], activeCount: 1, nextChangeMs: untilBoundary }

  const dur = (i) => Math.max(MIN_SLIDE_SECONDS, i.duration_seconds ?? defaultSeconds) * 1000
  const total = active.reduce((s, i) => s + dur(i), 0)
  let pos = nowMs % total
  for (const item of active) {
    const d = dur(item)
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
