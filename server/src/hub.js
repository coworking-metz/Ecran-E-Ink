// Long-polling : réveille immédiatement les écrans concernés quand le dashboard modifie quelque chose.
// Tout est en mémoire (un seul process serveur) : après un redémarrage, `bootId` change, donc les écrans reçoivent
// une réponse immédiate et se resynchronisent, sans rien perdre.
import { randomBytes } from 'node:crypto'

export const bootId = randomBytes(4).toString('hex')

const versions = new Map() // deviceId -> compteur
const waiters = new Map() // deviceId -> Set<fonction de réveil>
const reasons = new Map() // deviceId -> raison de la dernière notification

// Jeton de version d'un écran : change à chaque modification qui peut affecter ce qu'il affiche.
export const versionOf = (deviceId) => `${bootId}.${versions.get(deviceId) ?? 0}`

// Raisons « urgentes » : une action explicite de l'utilisateur, à appliquer sans délai de regroupement.
// Les autres (`edit` : enregistrement d'une création, modification de playlist…) sont regroupées par le Pi.
export const URGENT_REASONS = new Set(['show', 'refresh', 'calibration', 'margins'])
export const reasonOf = (deviceId) => reasons.get(deviceId) ?? 'edit'

export function notify(deviceIds, reason = 'edit') {
  for (const id of new Set(deviceIds)) {
    versions.set(id, (versions.get(id) ?? 0) + 1)
    reasons.set(id, reason)
    for (const wake of [...(waiters.get(id) ?? [])]) wake()
  }
}

/**
 * Attend un changement pour cet écran. Résout 'changed' | 'timeout' | 'aborted'.
 * @param sinceVersion  version connue du client ; si elle n'est plus la courante, résout tout de suite.
 * @param maxMs         attente maximale
 * @param closeSource   émetteur d'un événement 'close' (connexion coupée côté client) : libère l'attente
 */
export function waitForChange(deviceId, sinceVersion, maxMs, closeSource) {
  return new Promise((resolve) => {
    if (sinceVersion !== versionOf(deviceId)) return resolve('changed')
    let done = false
    const set = waiters.get(deviceId) ?? new Set()
    waiters.set(deviceId, set)
    const finish = (why) => {
      if (done) return
      done = true
      clearTimeout(timer)
      set.delete(wake)
      if (set.size === 0) waiters.delete(deviceId)
      closeSource?.off?.('close', onClose)
      resolve(why)
    }
    const wake = () => finish('changed')
    const onClose = () => finish('aborted')
    const timer = setTimeout(() => finish('timeout'), Math.max(0, maxMs))
    set.add(wake)
    closeSource?.once?.('close', onClose)
  })
}

export const waiterCount = () => [...waiters.values()].reduce((n, s) => n + s.size, 0) // pour les tests
