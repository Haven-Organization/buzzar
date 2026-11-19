#!/bin/sh
# Builds Buzzar and deploys it to the local nginx web root, like the Haven build at /usr/share/nginx/html/haven.
# Served at http://localhost:8090 by scripts/buzzar/nginx-buzzar.conf (a site of its own, because the app uses
# absolute paths like /gltf/… and needs cross-origin isolation headers).
#
# Usage: scripts/buzzar/deploy-local.sh [--no-build]
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WEB=${BUZZAR_WEB_ROOT:-/usr/share/nginx/html/buzzar}

cd "$ROOT"
if [ "${1:-}" != "--no-build" ]; then
  yarn -s vite build
  # The developer docs (VitePress) build into dist/docs, served at /docs.
  yarn -s docs:build
fi

if [ -d "$WEB" ]; then
  BACKUP="$WEB.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$WEB" "$BACKUP"
  echo "previous build backed up to $BACKUP"
  # Keep the newest KEEP_BACKUPS backups (each is a whole build, ~200 MB); they used to pile up by the hundred.
  ls -d "$WEB".bak-* 2>/dev/null | sort | head -n "-${KEEP_BACKUPS:-5}" | while read -r old; do rm -rf -- "$old"; done
fi

mkdir -p "$WEB"
# Local world previews (public/gltf/test/_tmp-*) are dev-only and large.
# Earlier builds' hashed chunks in assets/ stay (P = protect from --delete) for a week: an app still open on the
# previous build loads views it hasn't loaded yet from them, and a missing one was a blank white screen.
rsync -a --delete --filter 'P /assets/**' --exclude 'gltf/test/_tmp-*' dist/ "$WEB/"
find "$WEB/assets" -type f -mtime +7 -delete
echo "deployed $(du -sh "$WEB" | cut -f1) to $WEB"
