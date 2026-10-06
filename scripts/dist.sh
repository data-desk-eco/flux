#!/usr/bin/env bash
# assemble the pages artifact in dist/, cache-busting js/css with the git sha.
# usage: dist.sh <sha> [local]
#   public: plumes are read live off the archive
#   local:  bake the local plumes.parquet (the only artifact that may carry
#           ghgsat) and licences.parquet, and set <meta name="private">
set -euo pipefail

die() { echo "dist.sh: $*" >&2; exit 1; }

V="${1:-dev}"; V="${V:0:8}"
MODE="${2:-}"
WASM=dist/vendor/duckdb/duckdb-eh.wasm

# the whole web tree, so no new module can fall off a file list. web/data is
# a symlink to the private bakes, and never rides along
rm -rf dist
cp -R web dist
rm -rf dist/data dist/vendor/.ok
mkdir -p dist/data

[ -f "$WASM" ] && [ "$(wc -c < "$WASM")" -lt 30000000 ]   # see vendor.sh
grep -q "duckdbAsset('duckdb-eh\.wasm')" dist/shell/data.js

if [ "$MODE" = local ]; then
    for f in plumes licences; do
        [ -f "web/data/$f.parquet" ] || die "web/data/$f.parquet is" \
            "missing: the private deploy would serve the public map"
        cp "web/data/$f.parquet" dist/data/
    done
    sed -i.bak 's#<head>#<head><meta name="private">#' dist/index.html
fi

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

# the bakes are fetched by literal path, not imported
sed -i.bak -E "s#(data/plumes\.parquet)#\1?v=$V#" dist/config.js
sed -i.bak -E "s#(data/licences\.parquet)#\1?v=$V#" dist/methane/licences.js
find dist -name '*.bak' -delete

# a leak of licensed data is the worst outcome here, so the public build
# proves it carries none: nothing baked, no flag set, and the flag still the
# only thing the private layers hang off
PRIV='const PRIVATE = !!document.querySelector(.meta\[name="private"\].)'
if [ "$MODE" != local ]; then
    [ -z "$(find dist -name '*.parquet' -print -quit)" ] \
        || die 'a parquet is baked into the public build'
    ! grep -q 'name="private"' dist/index.html \
        || die 'the public build carries <meta name="private">'
    grep -q "$PRIV" dist/config.js \
        || die 'config.js no longer derives PRIVATE from the meta tag'
    grep -q 'if (PRIVATE) addLicenceLayers' dist/config.js \
        || die 'the mapstand licence layers are no longer gated on PRIVATE'
fi
