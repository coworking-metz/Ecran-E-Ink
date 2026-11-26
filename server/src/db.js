import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.DATA_DIR || join(here, '..', 'data')
export const CREATIONS_DIR = join(DATA_DIR, 'creations')
export const ASSETS_DIR = join(DATA_DIR, 'assets')
mkdirSync(CREATIONS_DIR, { recursive: true })
mkdirSync(ASSETS_DIR, { recursive: true })

export const db = new DatabaseSync(join(DATA_DIR, 'eink.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS creations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    scene      TEXT NOT NULL,
    png_hash   TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    token           TEXT NOT NULL UNIQUE,
    width           INTEGER NOT NULL DEFAULT 1200,
    height          INTEGER NOT NULL DEFAULT 825,
    refresh_seconds INTEGER NOT NULL DEFAULT 300,
    creation_id     INTEGER REFERENCES creations(id) ON DELETE SET NULL,
    last_seen       TEXT
  );

  CREATE TABLE IF NOT EXISTS assets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL,
    width      INTEGER,
    height     INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// ---- migrations légères (bases créées avant l'ajout des templates) ----
const addColumn = (table, col, ddl) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
}
addColumn('creations', 'is_template', 'INTEGER NOT NULL DEFAULT 0')
addColumn('creations', 'template_key', 'TEXT')
addColumn('creations', 'template_hash', 'TEXT') // empreinte de la scène livrée : sert à savoir si l'utilisateur a modifié le template
addColumn('assets', 'brand_key', 'TEXT')
addColumn('devices', 'shown_hash', 'TEXT') // empreinte de l'image que l'écran dit afficher (rapportée par le Pi)
addColumn('devices', 'shown_at', 'TEXT')
addColumn('devices', 'refresh_nonce', 'INTEGER NOT NULL DEFAULT 0') // incrémenté par « forcer le rafraîchissement »
addColumn('devices', 'refreshed_nonce', 'INTEGER NOT NULL DEFAULT 0') // dernier compteur pris en compte par le Pi
addColumn('devices', 'phase_offset_ms', 'INTEGER NOT NULL DEFAULT 0') // décalage de la rotation (« afficher ce slide maintenant »)
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_creations_template_key ON creations(template_key) WHERE template_key IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_brand_key ON assets(brand_key) WHERE brand_key IS NOT NULL;
`)

// ---- playlist : plusieurs slides par écran, chacun avec sa durée et sa période de diffusion ----
db.exec(`
  CREATE TABLE IF NOT EXISTS playlist_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    creation_id      INTEGER NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
    position         INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,          -- NULL = durée par défaut (réglée dans les options)
    starts_at        TEXT,             -- ISO 8601 UTC, NULL = tout de suite
    ends_at          TEXT,             -- ISO 8601 UTC, NULL = sans fin
    enabled          INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_device ON playlist_items(device_id, position);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`)

// Reprise de l'ancien modèle (une seule création par écran) : elle devient le premier slide de la playlist.
db.exec(`
  INSERT INTO playlist_items (device_id, creation_id, position)
  SELECT d.id, d.creation_id, 0 FROM devices d
  WHERE d.creation_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM playlist_items p WHERE p.device_id = d.id)
`)

export const SETTING_DEFAULTS = { default_slide_seconds: 120, fallback_creation_id: null, margins: { top: 0, right: 0, bottom: 0, left: 0 } }
export const getSettings = () => {
  const out = { ...SETTING_DEFAULTS }
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) if (key in out) out[key] = JSON.parse(value)
  return out
}
export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
