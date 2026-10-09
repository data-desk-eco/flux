#!/usr/bin/env bash
# the app against the brand, headless: the intro, the map and an open flare
# card through vendor/dd/audit.js. any finding config.audit does not declare
# fails it. needs the data desk `browse` (skills/browser in ~/data-desk)
set -euo pipefail
BROWSE="${BROWSE:-$HOME/data-desk/skills/browser/browse}"
PORT=8765
python3 scripts/serve.py $PORT web 2>/dev/null &
trap 'kill $!' EXIT
sleep 1
curl -sfI "localhost:$PORT/" >/dev/null \
    || { echo "audit: the server did not start" >&2; exit 1; }
"$BROWSE" "http://localhost:$PORT/#map=11/25.92/51.55" --size 1440x900 \
    --wait 'dd-panel[intro]' --timeout 120000 --eval "(async () => {
    const wait = t => new Promise(r => setTimeout(r, t));
    const { audit } = await import('/vendor/dd/audit.js');
    const run = () => audit(document.body,
        { map: flux.map, allow: flux.config.audit });
    await wait(3000);
    const found = run();
    document.getElementById('enter-btn').click();
    await wait(15000);
    const f = flux.map.queryRenderedFeatures(
        { layers: ['detections', 'vnf'] })[0];
    if (f) flux.map.fire('click', { point: flux.map.project(
        f.geometry.coordinates), lngLat: { lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1] }, originalEvent: {} });
    await wait(8000);
    return [...found, ...run()].map(x => [x.rule, x.at, x.got, x.want]
        .join(' | ')).filter((x, i, a) => a.indexOf(x) === i);
})()" | python3 -c '
import json, sys
text = sys.stdin.read()
found = json.loads(text[text.index("["):text.rindex("]") + 1])
print("\n".join(found) or "dd audit: clean")
sys.exit(1 if found else 0)'
