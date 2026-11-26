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

# Vérification après déploiement : l'app répond, et n'écoute que sur la boucle locale (derrière le reverse proxy).
PORT="$(grep -E '^EINK_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '\r' || true)"; PORT="${PORT:-3000}"
ok=""
for _ in $(seq 1 20); do
  curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && { ok=1; break; }
  sleep 1
done
if [ -z "$ok" ]; then
  echo "✗ l'app ne répond pas sur 127.0.0.1:$PORT après le déploiement"; pm2 logs ecran-eink --lines 30 --nostream || true; exit 1
fi
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "^(0\.0\.0\.0|\*|\[::\]):$PORT$"; then
  echo "✗ le port $PORT écoute sur toutes les interfaces : il doit rester sur 127.0.0.1 (EINK_HOST)"; exit 1
fi
echo "✓ santé OK (127.0.0.1:$PORT, non exposé)"

pm2 save
echo "Déployé : $(git log --oneline -1)"
