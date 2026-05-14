#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_DIR="$ROOT_DIR/releases"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
ARCHIVE="$RELEASE_DIR/atc-erp-release-$TIMESTAMP.tar.gz"

mkdir -p "$RELEASE_DIR"

cd "$ROOT_DIR"
npm ci
npm run typecheck
npm test
npm run build

tar \
  --exclude="./node_modules" \
  --exclude="./.next/cache" \
  --exclude="./coverage" \
  --exclude="./data" \
  --exclude="./releases" \
  --exclude="./.git" \
  -czf "$ARCHIVE" .

echo "$ARCHIVE"
