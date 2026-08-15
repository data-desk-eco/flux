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

V="${1:-dev}"; V="${V:0:8}"
rm -rf dist
mkdir -p dist/data
cp web/index.html web/style.css web/*.js dist/
cp -r web/vendor dist/vendor
[ -f dist/vendor/duckdb/duckdb-eh.wasm ]
[ "$(wc -c < dist/vendor/duckdb/duckdb-eh.wasm)" -lt 25000000 ]
grep -q "duckdbAsset('duckdb-eh\.wasm')" dist/vendor/cartograph/data.js
if [ "${2:-}" = local ]; then
    cp web/data/plumes.parquet web/data/licences.parquet dist/data/
    sed -i.bak 's#<head>#<head><meta name="private">#' dist/index.html
fi

# bust the entry points in index.html, the app-local es-module import graph
# (vendor modules stay unbusted so each resolves to one url = one instance),
# and the local parquet fetches (the store url self-busts hourly)
sed -i.bak -E "s#(config\.js|\"style\.css)#\1?v=$V#g" dist/index.html
sed -i.bak -E "s#(from '\./[a-z]+\.js)'#\1?v=$V'#g" dist/*.js
sed -i.bak -E "s#(data/plumes\.parquet)#\1?v=$V#g" dist/config.js
sed -i.bak -E "s#(data/licences\.parquet)#\1?v=$V#g" dist/licences.js
rm dist/*.bak
