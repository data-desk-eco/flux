#!/usr/bin/env bash
# assemble the pages artifact in dist/, cache-busting js/css with the git sha.
# usage: dist.sh <sha> [local]
#   public (deploy.yml): plumes are read live from the provider detections
#   objects on the central datadesk store
#   local  (deploy-private): bake the locally-built plumes.parquet — the only
#   artifact that may carry ghgsat — and set <meta name="private">, which tells
#   the page to read it instead of the store and unlocks the datadesk-only
#   layers (MapStand licence areas baked as restricted GeoParquet)
set -euo pipefail

die() { echo "dist.sh: $*" >&2; exit 1; }

V="${1:-dev}"; V="${V:0:8}"
MODE="${2:-}"

rm -rf dist
# the whole web tree — card/, flaring/ and its wasm, methane/, vendor/,
# terminals.geojson — rather than a file list a new module can fall off.
# web/data is a symlink to the local bakes and never rides along: cp copies the
# link, and dist/data would then resolve straight back into the private files.
cp -R web dist
rm -rf dist/data dist/vendor/.ok
mkdir -p dist/data

[ -f dist/vendor/duckdb/duckdb-eh.wasm ]
[ "$(wc -c < dist/vendor/duckdb/duckdb-eh.wasm)" -lt 25000000 ]
grep -q "duckdbAsset('duckdb-eh\.wasm')" dist/vendor/cartograph/data.js

if [ "$MODE" = local ]; then
    for f in plumes licences; do
        [ -f "web/data/$f.parquet" ] || die "web/data/$f.parquet is missing —" \
            "a private deploy without it serves the public map behind the access gate"
        cp "web/data/$f.parquet" dist/data/
    done
    sed -i.bak 's#<head>#<head><meta name="private">#' dist/index.html
fi

# stamp the sha into every first-party module specifier + the html asset tags,
# so a deploy can never pair a fresh module with a stale cached one (github
# pages caches for 10 min). vendor bundles keep their own paths — they only
# change when revendored.
#
# the last rule strips the stamp back off vendor specifiers. vendor trees are
# pruned from the rewrite, so cartograph's own `from './detail.js'` stays bare;
# stamping our `from './vendor/cartograph/detail.js'` would name a second url
# for the same file and the browser would hold two module instances of it —
# app.js initialising one while card.js calls the other, whose cfg is still
# undefined.
# the entry module is a <script src>, not an import, and it slipped through: on
# 3 august the browser held a four-hour-old config.js against a freshly stamped
# clustering.js, so the persistence gate ran the old rule over the new table.
# the path pattern forbids a slash, so it stamps config.js and style.css and
# leaves vendor/maplibre-gl.js alone.
find dist -path dist/vendor -prune -o -path dist/flaring/s2/vendor -prune -o \
  \( -name '*.js' -o -name '*.html' \) -print0 | xargs -0 sed -i.bak -E \
  -e "s|(<script[^>]* src=\")((\./)?[^\"?/]+\.m?js)(\")|\1\2?v=$V\4|g" \
  -e "s|(<link[^>]* href=\")((\./)?[^\"?/]+\.css)(\")|\1\2?v=$V\4|g" \
  -e "s|(from ')(\.[^']+\.m?js)(')|\1\2?v=$V\3|g" \
  -e "s|(import\(')(\.[^']+\.m?js)('\))|\1\2?v=$V\3|g" \
  -e "s|(new URL\(')(\.[^']+\.m?js)(')|\1\2?v=$V\3|g" \
  -e "s|\?v=[0-9a-z]+|?v=$V|g" \
  -e "s|(vendor/[^']*\.m?js)\?v=[0-9a-z]+|\1|g"

# the two baked parquets are fetched by literal path, not imported, so they miss
# every rule above (the store's own urls self-bust hourly)
sed -i.bak -E "s#(data/plumes\.parquet)#\1?v=$V#" dist/config.js
sed -i.bak -E "s#(data/licences\.parquet)#\1?v=$V#" dist/methane/licences.js

find dist -name '*.bak' -delete

# a leak of licensed data is the worst outcome available here, so the public
# build proves it carries none rather than being reviewed for it. three
# independent facts, each of them fatal: nothing baked, nothing that would set
# the flag, and the flag still the only thing the private layers hang off.
if [ "$MODE" != local ]; then
    [ -z "$(find dist -name '*.parquet' -print -quit)" ] \
        || die 'a parquet is baked into the public build (dist/data is the private bake)'
    ! grep -q 'name="private"' dist/index.html \
        || die 'the public build carries <meta name="private">'
    grep -q 'const PRIVATE = !!document.querySelector(.meta\[name="private"\].)' dist/config.js \
        || die 'config.js no longer derives PRIVATE from the meta tag — this build cannot prove what it ships'
    grep -q 'if (PRIVATE) addLicenceLayers' dist/config.js \
        || die 'the mapstand licence layers are no longer gated on PRIVATE'
fi
