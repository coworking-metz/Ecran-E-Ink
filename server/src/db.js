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
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_creations_template_key ON creations(template_key) WHERE template_key IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_brand_key ON assets(brand_key) WHERE brand_key IS NOT NULL;
`)
