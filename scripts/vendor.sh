#!/usr/bin/env bash
# vendor the third-party half of web/: maplibre, duckdb-wasm-lite, inter and
# the data desk design system. everything else under web/ is first-party.
set -euo pipefail

VENDOR=web/vendor
DD_DIST="${DD_DIST:-$HOME/Tools/design/dist}"
DUCKDB_TAG="v2.0.0-alpha1-lite.5"   # DuckDB data engine release
grep -q "DUCKDB_RELEASE = '$DUCKDB_TAG'" web/shell/data.js

rm -rf "$VENDOR"
mkdir -p "$VENDOR/fonts"

ML=https://unpkg.com/maplibre-gl@5.1.0/dist/maplibre-gl
echo "maplibre-gl@5.1.0 ..."
curl -sLo "$VENDOR/maplibre-gl.js" "$ML.js"
curl -sLo "$VENDOR/maplibre-gl.css" "$ML.css"

echo "duckdb-wasm-lite $DUCKDB_TAG ..."
mkdir -p "$VENDOR/duckdb"
gh release download "$DUCKDB_TAG" -R data-desk-eco/duckdb-wasm-lite \
    -p 'duckdb-eh.wasm' -p 'duckdb-browser.mjs' \
    -p 'duckdb-browser-eh.worker.js' \
    -D "$VENDOR/duckdb" --clobber
# the guard is for the category error: a build that linked gdal and proj, or
# the stock npm wasm (35.96 MB). the lite build is 24.17 MB
[ "$(wc -c < "$VENDOR/duckdb/duckdb-eh.wasm")" -lt 30000000 ] || {
    echo "duckdb-wasm-lite: WASM exceeds 30 MB" >&2
    exit 1
}

echo "dd design system (from $DD_DIST) ..."
mkdir -p "$VENDOR/dd"
# dd.js is the kernel the app is built on; audit.js checks a page against it.
# map.css is the review page's alone, until it moves onto the elements
cp "$DD_DIST/dd.js" "$DD_DIST/audit.js" "$DD_DIST/style.dark.json" \
   "$DD_DIST/worldmap.js" "$DD_DIST/land.json" "$DD_DIST/map.css" \
   "$VENDOR/dd/"

echo "inter font ..."
# a desktop chrome agent, so google serves woff2
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
UA+=' (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
# regular, bold and italic: the guidelines' fonts (pdf:22)
AXES='ital,opsz,wght@0,14..32,400..700;1,14..32,400..700'
curl -sH "User-Agent: $UA" \
  "https://fonts.googleapis.com/css2?family=Inter:$AXES&display=swap" |
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
