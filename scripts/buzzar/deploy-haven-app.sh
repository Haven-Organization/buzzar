#!/bin/sh
# Builds Buzzar (app + docs at /docs) and uploads it to https://buzzar.haven.software on the Haven VPS.
# The nginx site is scripts/buzzar/nginx-buzzar-haven.conf (installed on the VPS, with certbot's TLS lines).
#
# Needs the `Glowers_VPS` SSH host alias. Usage: scripts/buzzar/deploy-haven-app.sh [--no-build]
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEST=${BUZZAR_APP_DEST:-Glowers_VPS:/var/www/buzzar.haven.software/site/}

cd "$ROOT"
if [ "${1:-}" != "--no-build" ]; then
  yarn -s vite build
  yarn -s docs:build
fi

# Local world previews (public/gltf/test/_tmp-*) are dev-only and large; source maps aren't needed in public.
rsync -rlt --delete --chmod=D755,F644 --exclude 'gltf/test/_tmp-*' --exclude '*.map' dist/ "$DEST"
echo "deployed to $DEST"
