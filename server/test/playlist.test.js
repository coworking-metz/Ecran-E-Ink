import { test } from 'node:test'
import assert from 'node:assert/strict'
import { schedule, nextCheckSeconds, MIN_SLIDE_SECONDS } from '../src/playlist.js'

const T = (s) => Date.parse(s)
const slide = (id, o = {}) => ({ id, creation_id: id, position: id, duration_seconds: null, starts_at: null, ends_at: null, enabled: 1, png_hash: `h${id}`, ...o })
const at = (items, when, def = 60) => schedule(items, typeof when === 'string' ? T(when) : when, def)

test('aucun slide : rien à afficher, pas de changement prévu', () => {
  const r = at([], '2026-06-01T10:00:00Z')
  assert.equal(r.item, null)
  assert.equal(r.activeCount, 0)
  assert.equal(r.nextChangeMs, Infinity)
})

test('un seul slide : toujours le même, jamais de rotation', () => {
  const r = at([slide(1)], '2026-06-01T10:00:07Z')
  assert.equal(r.item.id, 1)
  assert.equal(r.nextChangeMs, Infinity)
})

test('plusieurs slides : rotation dans l’ordre, chacun pendant sa durée par défaut', () => {
  const items = [slide(1), slide(2), slide(3)] // 60 s chacun, cycle de 180 s
  const base = Math.floor(T('2026-06-01T10:00:00Z') / 180_000) * 180_000 // début d'un cycle
  assert.equal(at(items, base).item.id, 1)
  assert.equal(at(items, base + 59_999).item.id, 1)
  assert.equal(at(items, base + 60_000).item.id, 2)
  assert.equal(at(items, base + 119_999).item.id, 2)
  assert.equal(at(items, base + 120_000).item.id, 3)
  assert.equal(at(items, base + 180_000).item.id, 1, 'le cycle recommence')
  assert.equal(at(items, base + 10_000).nextChangeMs, 50_000, 'temps restant sur le slide')
})

test('durée propre à un slide : prioritaire sur la valeur par défaut', () => {
  const items = [slide(1, { duration_seconds: 120 }), slide(2)] // 120 + 60 = 180 s
  const base = Math.floor(T('2026-06-01T10:00:00Z') / 180_000) * 180_000
  assert.equal(at(items, base + 119_000).item.id, 1)
  assert.equal(at(items, base + 121_000).item.id, 2)
  assert.equal(at(items, base + 121_000).nextChangeMs, 59_000)
})

test(`durée plancher de ${MIN_SLIDE_SECONDS} s (protège l'écran e-ink)`, () => {
  const items = [slide(1, { duration_seconds: 5 }), slide(2, { duration_seconds: 1 })]
  const base = Math.floor(T('2026-06-01T10:00:00Z') / 60_000) * 60_000
  assert.equal(at(items, base + 29_000).item.id, 1)
  assert.equal(at(items, base + 31_000).item.id, 2)
})

test('l’ordre suit `position`, pas l’identifiant', () => {
  const items = [slide(1, { position: 2 }), slide(2, { position: 1 })]
  const base = Math.floor(T('2026-06-01T10:00:00Z') / 120_000) * 120_000
  assert.equal(at(items, base).item.id, 2)
  assert.equal(at(items, base + 60_000).item.id, 1)
})

test('date de début : pas affiché avant, affiché après ; le changement est annoncé', () => {
  const items = [slide(1), slide(2, { starts_at: '2026-06-01T12:00:00Z' })]
  const before = at(items, '2026-06-01T11:59:00Z')
  assert.equal(before.item.id, 1)
  assert.equal(before.activeCount, 1)
  assert.equal(before.nextChangeMs, 60_000, 'prochain changement = le début du slide 2')
  assert.equal(at(items, '2026-06-01T12:00:00Z').activeCount, 2)
})

test('date de fin : exclusive, le slide disparaît à l’instant exact', () => {
  const items = [slide(1), slide(2, { ends_at: '2026-06-01T12:00:00Z' })]
  assert.equal(at(items, '2026-06-01T11:59:59.999Z').activeCount, 2)
  assert.equal(at(items, '2026-06-01T12:00:00Z').activeCount, 1)
  assert.equal(at(items, '2026-06-01T12:00:00Z').item.id, 1)
  assert.equal(at(items, '2026-06-01T11:59:30Z').nextChangeMs <= 30_000, true)
})

test('période échue ou à venir seule : rien à afficher, mais on sait quand revenir', () => {
  const past = at([slide(1, { ends_at: '2026-05-01T00:00:00Z' })], '2026-06-01T10:00:00Z')
  assert.equal(past.item, null)
  assert.equal(past.nextChangeMs, Infinity)
  const future = at([slide(1, { starts_at: '2026-06-02T00:00:00Z' })], '2026-06-01T10:00:00Z')
  assert.equal(future.item, null)
  assert.equal(future.nextChangeMs, 14 * 3600_000)
})

test('slides désactivés ou sans image ignorés', () => {
  const items = [slide(1, { enabled: 0 }), slide(2, { png_hash: null }), slide(3)]
  const r = at(items, '2026-06-01T10:00:00Z')
  assert.equal(r.item.id, 3)
  assert.equal(r.activeCount, 1)
})

test('le créneau se calcule sur l’horloge : même résultat pour tous les écrans et après un redémarrage', () => {
  const items = [slide(1), slide(2), slide(3)]
  const now = T('2026-06-01T10:17:42Z')
  assert.equal(at(items, now).item.id, at(items, now).item.id)
  assert.deepEqual(at(items, now), at([...items].reverse(), now))
})

test('délai de retour du Pi : fin de créneau + 1 s, plafonné par le rafraîchissement, plancher 5 s', () => {
  assert.equal(nextCheckSeconds(50_000, 300), 51)
  assert.equal(nextCheckSeconds(50_400, 300), 52, 'arrondi par excès')
  assert.equal(nextCheckSeconds(Infinity, 300), 300)
  assert.equal(nextCheckSeconds(3_600_000, 300), 300, 'plafonné : on revient voir les modifications')
  assert.equal(nextCheckSeconds(100, 300), 5)
})
