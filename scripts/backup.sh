#!/usr/bin/env bash
# Sauvegarde cohérente des données : ./scripts/backup.sh <dossier-destination>
# La base est copiée avec VACUUM INTO (cohérent même si l'app tourne, contrairement à un cp à cause du mode WAL),
# puis les images (créations et visuels importés).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }
DATA="${DATA_DIR:-server/data}"
DEST="${1:?usage: backup.sh <dossier-destination>}/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
DB_PATH="$DATA/eink.db" OUT="$DEST/eink.db" node -e "
const { DatabaseSync } = require('node:sqlite')
new DatabaseSync(process.env.DB_PATH).exec(\"VACUUM INTO '\" + process.env.OUT.replace(/'/g, \"''\") + \"'\")
"
cp -a "$DATA/creations" "$DATA/assets" "$DEST/" 2>/dev/null || true
echo "Sauvegarde : $DEST"
