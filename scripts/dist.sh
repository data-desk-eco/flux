#!/usr/bin/env bash
# assemble the pages artifact in dist/, cache-busting js/css with the git sha.
# usage: dist.sh <sha>
set -euo pipefail

die() { echo "dist.sh: $*" >&2; exit 1; }

V="${1:-dev}"; V="${V:0:8}"
WASM=dist/vendor/duckdb/duckdb-eh.wasm

# the whole web tree, so no new module can fall off a file list. web/data
# is local scratch, and never rides along
rm -rf dist
cp -R web dist
rm -rf dist/data dist/vendor/.ok

[ -f "$WASM" ] && [ "$(wc -c < "$WASM")" -lt 30000000 ]   # see vendor.sh
grep -q "duckdbAsset('duckdb-eh\.wasm')" dist/shell/engine.js

# stamp the sha into every first-party specifier and html asset tag, so a
# deploy never pairs a fresh module with a stale cached one (pages caches for
# 10 min). every spelling of one file stamps to one url, so the browser holds
# one module instance. the entry <script src> takes no slash, so vendor js is
# left alone; a <link> has no module identity, so vendor css is stamped too.
find dist -path dist/vendor -prune -o \
  \( -name '*.js' -o -name '*.html' \) -print0 | xargs -0 sed -i.bak -E \
  -e "s|(<script[^>]* src=\")((\./)?[^\"?/]+\.m?js)(\")|\1\2?v=$V\4|g" \
  -e "s|(<link[^>]* href=\")((\./)?[^\"?]+\.css)(\")|\1\2?v=$V\4|g" \
  -e "s|(from ')(\.[^']+\.m?js)(')|\1\2?v=$V\3|g" \
  -e "s|(import\(')(\.[^']+\.m?js)('\))|\1\2?v=$V\3|g" \
  -e "s|(new URL\(')(\.[^']+\.m?js)(')|\1\2?v=$V\3|g" \
  -e "s|\?v=[0-9a-z]+|?v=$V|g" \
  -e "s|(vendor/[^']*\.m?js)\?v=[0-9a-z]+|\1|g"

find dist -name '*.bak' -delete

# the archive is read live: nothing is baked into the build
[ -z "$(find dist -name '*.parquet' -print -quit)" ] \
    || die 'a parquet is baked into the build'
