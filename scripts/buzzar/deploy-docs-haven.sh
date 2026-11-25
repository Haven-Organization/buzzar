#!/bin/sh
# Builds the developer docs for https://haven.software/buzzar/docs/ and uploads them to the Haven website's VPS.
# The haven-site repo's own deploy (npm run deploy) excludes /buzzar/docs/, so the two deploy independently.
#
# Needs the `haven-vps` SSH host alias (or set BUZZAR_DOCS_DEST). Usage: scripts/buzzar/deploy-docs-haven.sh [--no-build]
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/dist-docs-haven"
DEST=${BUZZAR_DOCS_DEST:-haven-vps:/var/www/haven.software/site/buzzar/docs/}

cd "$ROOT"
if [ "${1:-}" != "--no-build" ]; then
  DOCS_BASE=/buzzar/docs/ DOCS_OUT=../dist-docs-haven yarn -s docs:build
fi

rsync -rlt --delete --chmod=D755,F644 "$OUT/" "$DEST"
echo "deployed $(du -sh "$OUT" | cut -f1) of docs to $DEST"
