#!/usr/bin/env sh
# Build the Chrome Web Store upload zip. Includes runtime files only —
# no docs, tests, or source artwork. Run: sh scripts/package.sh
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/address-tracker-$VERSION.zip"

mkdir -p dist
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  content.css \
  page-hook.js \
  popup \
  onboarding \
  management \
  shared \
  icons/16.png icons/32.png icons/48.png icons/128.png \
  -x '*.DS_Store'

echo ""
echo "Wrote $OUT"
unzip -l "$OUT"
