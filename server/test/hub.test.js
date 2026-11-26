import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { bootId, notify, versionOf, waitForChange, waiterCount } from '../src/hub.js'

const id = () => Math.floor(Math.random() * 1e9) // identifiants isolés d'un test à l'autre

test('la version change à chaque notification, et seulement pour les écrans concernés', () => {
  const a = id(), b = id()
  const [va, vb] = [versionOf(a), versionOf(b)]
  assert.ok(va.startsWith(bootId))
  notify([a])
  assert.notEqual(versionOf(a), va)
  assert.equal(versionOf(b), vb)
  notify([a, a, a])
  assert.equal(versionOf(a).split('.')[1], '2', 'un même écran listé plusieurs fois n’est compté qu’une fois par notification')
})

test('attente réveillée par une notification', async () => {
  const d = id(), socket = new EventEmitter()
  const t0 = Date.now()
  const p = waitForChange(d, versionOf(d), 5000, socket)
  setTimeout(() => notify([d]), 30)
  assert.equal(await p, 'changed')
  assert.ok(Date.now() - t0 < 1000)
  assert.equal(waiterCount(), 0, 'plus d’attente en cours')
  assert.equal(socket.listenerCount('close'), 0, 'connexion toujours ouverte : l’écouteur de fermeture doit être retiré')
})

test('attente qui expire', async () => {
  const d = id()
  const t0 = Date.now()
  const socket = new EventEmitter()
  assert.equal(await waitForChange(d, versionOf(d), 60, socket), 'timeout')
  assert.ok(Date.now() - t0 >= 55)
  assert.equal(waiterCount(), 0)
  assert.equal(socket.listenerCount('close'), 0, 'écouteur retiré après expiration')
})

test('version périmée (ou autre démarrage du serveur) : réponse immédiate', async () => {
  const d = id()
  const t0 = Date.now()
  assert.equal(await waitForChange(d, 'ancienboot.7', 5000), 'changed')
  assert.equal(await waitForChange(d, undefined, 5000), 'changed')
  assert.ok(Date.now() - t0 < 100)
})

test('connexion coupée par le client : l’attente est libérée (pas de fuite)', async () => {
  const d = id(), socket = new EventEmitter()
  const p = waitForChange(d, versionOf(d), 5000, socket)
  assert.equal(waiterCount(), 1)
  socket.emit('close')
  assert.equal(await p, 'aborted')
  assert.equal(waiterCount(), 0)
  assert.equal(socket.listenerCount('close'), 0, 'écouteur retiré')
})

test('une notification réveille toutes les attentes du même écran, pas celles des autres', async () => {
  const d = id(), other = id()
  const mine = [waitForChange(d, versionOf(d), 5000), waitForChange(d, versionOf(d), 5000)]
  const theirs = waitForChange(other, versionOf(other), 100)
  notify([d])
  assert.deepEqual(await Promise.all(mine), ['changed', 'changed'])
  assert.equal(await theirs, 'timeout')
})
