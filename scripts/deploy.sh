#!/usr/bin/env bash
# Mise à jour en production, à lancer sur le serveur depuis le dépôt : ./scripts/deploy.sh
# Prérequis : Node >= 22 (EINK_NODE_BIN = son dossier bin, défaut ~/.local/node22/bin), pm2, fichier .env.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${EINK_NODE_BIN:-$HOME/.local/node22/bin}:$PATH" # npm relance « node » via le PATH : il doit être le bon
node -e "process.exit(+process.versions.node.split('.')[0] >= 22 ? 0 : 1)" || { echo "Node >= 22 requis (trouvé $(node -v))"; exit 1; }

[ -n "${EINK_BACKUP_DIR:-}" ] && ./scripts/backup.sh "$EINK_BACKUP_DIR" || echo "(pas de sauvegarde : EINK_BACKUP_DIR non défini)"
git pull --ff-only
npm ci --no-audit --no-fund
npm run build
EINK_NODE="$(command -v node)" pm2 startOrReload ecosystem.config.cjs --only ecran-eink --update-env
pm2 save
echo "Déployé : $(git log --oneline -1)"
