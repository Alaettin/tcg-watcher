#!/usr/bin/env bash
# Pull latest, rebuild app image, restart stack.
# Usage: ssh root@strato "cd /opt/pokemon-watcher && ./scripts/deploy.sh"

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "missing .env (copy .env.prod.example and fill it in)"
  exit 1
fi

echo "[deploy] git pull..."
git pull --ff-only

echo "[deploy] building app image..."
docker compose -f docker-compose.prod.yml build app

echo "[deploy] restarting stack..."
docker compose -f docker-compose.prod.yml up -d

echo "[deploy] done. tailing app logs (Ctrl+C to exit)..."
docker compose -f docker-compose.prod.yml logs -f --tail=50 app
