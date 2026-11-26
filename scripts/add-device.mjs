// Crée un écran dans la base de CET environnement et affiche son jeton (une seule fois) en JSON.
//   node --env-file=.env scripts/add-device.mjs "Nom de l'écran"
// Utile en production, où la connexion admin passe par le SSO (pas d'accès API sans navigateur).
import { randomBytes } from 'node:crypto'
import { db } from '../server/src/db.js'

const name = process.argv[2] || 'Écran'
const token = randomBytes(24).toString('hex')
const info = db
  .prepare('INSERT INTO devices (name, token, width, height, refresh_seconds) VALUES (?, ?, 1200, 825, 300)')
  .run(name, token)
console.log(JSON.stringify({ id: Number(info.lastInsertRowid), name, token }))
