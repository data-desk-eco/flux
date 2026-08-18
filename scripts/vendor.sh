#!/usr/bin/env bash
# vendor the third-party half of web/ into web/vendor: maplibre, duckdb-wasm-lite,
# the inter font and the data desk design system dist. everything else under web/
# is first-party — the shell in web/shell/ included, since flux absorbed it.
set -euo pipefail

VENDOR=web/vendor
DD_DIST="${DD_DIST:-$HOME/Tools/design/dist}"
DUCKDB_TAG="v2.0.0-alpha1-lite.5"   # DuckDB data engine release
grep -q "DUCKDB_RELEASE = '$DUCKDB_TAG'" web/shell/data.js

rm -rf "$VENDOR"
mkdir -p "$VENDOR/fonts"

echo "maplibre-gl@5.1.0 ..."
curl -sLo "$VENDOR/maplibre-gl.js"  "https://unpkg.com/maplibre-gl@5.1.0/dist/maplibre-gl.js"
curl -sLo "$VENDOR/maplibre-gl.css" "https://unpkg.com/maplibre-gl@5.1.0/dist/maplibre-gl.css"

# DuckDB reads Parquet and runs SQL in its worker. Cloudflare applies its normal
# caching and Brotli compression to these standard asset names.
echo "duckdb-wasm-lite $DUCKDB_TAG ..."
mkdir -p "$VENDOR/duckdb"
gh release download "$DUCKDB_TAG" -R data-desk-eco/duckdb-wasm-lite \
    -p 'duckdb-eh.wasm' -p 'duckdb-browser.mjs' \
    -p 'duckdb-browser-eh.worker.js' \
    -D "$VENDOR/duckdb" --clobber
# the guard is for the category error — a build that linked gdal and proj, or the
# stock npm wasm (35.96 MB) vendored by mistake. 25 MB was that with room to spare
# when the profile was duckdb 1.5.5 at 20.35 MB; the 2.0 substrate is 24.17 MB, so
# the same intent is 30 MB. it still sits below every build this must refuse.
[ "$(wc -c < "$VENDOR/duckdb/duckdb-eh.wasm")" -lt 30000000 ] || {
    echo "duckdb-wasm-lite: WASM exceeds 30 MB" >&2
    exit 1
}

echo "dd design system (from $DD_DIST) ..."
mkdir -p "$VENDOR/dd"
cp -r "$DD_DIST/map.css" "$DD_DIST/style.dark.json" "$DD_DIST/palette.js" \
      "$DD_DIST/markings.js" "$DD_DIST/markings" "$DD_DIST/worldmap.js" \
      "$DD_DIST/land.json" "$VENDOR/dd/"

echo "inter font ..."
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
curl -sH "User-Agent: $UA" \
  "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400..500;1,14..32,400..500&display=swap" |
python3 -c "
import re, urllib.request, sys
css = sys.stdin.read()
out, i = '', 0
for block in re.split(r'(?=/\*)', css):
    if not block.strip().startswith('/* latin */'): continue
    url = re.search(r'url\((https://[^)]+\.woff2)\)', block)
    if not url: continue
    fname = f'inter-latin-{i}.woff2'
    urllib.request.urlretrieve(url.group(1), f'$VENDOR/fonts/{fname}')
    out += block.replace(url.group(1), fname) + '\n'
    i += 1
open('$VENDOR/fonts/inter.css', 'w').write(out)
print(f'  {i} latin font files')
"
