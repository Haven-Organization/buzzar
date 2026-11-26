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

# Buzzar: build the new version next to the live one, then swap the two folders in one atomic rename
# (mv --exchange), so a reload gets all of the old build or all of the new one, never a mix or a stale page
# halfway through. The staging copy starts as hard links to the live build (instant, no extra space), which also
# keeps old asset chunks for pages still running the previous build; rsync writes changed files as new files, so the
# live build is untouched until the swap. The folder swapped out becomes the backup.
STAGE="$WEB.next"
rm -rf -- "$STAGE"
if [ -d "$WEB" ]; then
  cp -al "$WEB" "$STAGE"
else
  mkdir -p "$STAGE"
fi
rsync -a --delete --filter 'P /assets/**' --exclude 'gltf/test/_tmp-*' dist/ "$STAGE/"
find "$STAGE/assets" -type f -mtime +7 -delete
if [ -d "$WEB" ]; then
  mv --exchange -T "$STAGE" "$WEB"
  BACKUP="$WEB.bak-$(date +%Y%m%d-%H%M%S)"
  mv -T "$STAGE" "$BACKUP"
  echo "previous build kept as $BACKUP"
  ls -d "$WEB".bak-* 2>/dev/null | sort | head -n "-${KEEP_BACKUPS:-5}" | while read -r old; do rm -rf -- "$old"; done
else
  mv -T "$STAGE" "$WEB"
fi
echo "deployed $(du -sh "$WEB" | cut -f1) to $WEB"
