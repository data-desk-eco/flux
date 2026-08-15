// Candidate sources from the provider-owned `infrastructure` tables. Which
// providers publish one is the archive's statement, not this file's, and a
// candidate feature carries no per-provider styling at all — so a fifth source
// appears here on its own.
// DuckDB applies the viewport bounds against Hilbert-clustered lon/lat row
// groups. Loaded optimistically for the viewport
// past MIN_ZOOM, plus a radius query around the selected plume with the
// attributed feature(s) highlighted. drawn as dd waypoint markings (white ×,
// orange and larger when attributed) over an invisible fat hit layer.

import { ensureMark, hoverPopup } from './vendor/cartograph/shell.js';
import { map as dd } from './vendor/dd/palette.js';
import { objects } from './vendor/cartograph/archive.js';
import { escapeHtml, fmtMetres, haversineM } from './vendor/cartograph/util.js';

const MIN_ZOOM = 13;
const MAX_SCAN = 4000, MAX_SHOW = 300;
const PT = dd.adjusted.white, HL = dd.adjusted.orange;

// ch4id feature ids are OSM:w<id>; older attributions carry OSM:way/<id>
const normId = id => id.replace(/^OSM:(way|node|relation)\//, (_, t) => `OSM:${t[0]}`);

let map, query;

const literal = value => `'${value.replaceAll("'", "''")}'`;

// one query per object, swept independently, which keeps the property the glob
// was for: a provider that has not published yet costs only its own rows
async function fetchRect(rect) {
    const settled = await Promise.allSettled((await objects('infrastructure').catch(() => [])).map(table => query(`
        select * exclude (geometry, cell)
        from read_parquet(${literal(table)})
        where lon between ${Number(rect.minX)} and ${Number(rect.maxX)}
          and lat between ${Number(rect.minY)} and ${Number(rect.maxY)}
          and kind not in ('pipeline', 'field', 'oilfield', 'gas_field',
                           'offshore_field', 'licence_area', 'licence_block')
        limit ${MAX_SCAN}
    `)));
    for (const r of settled)
        if (r.status === 'rejected') console.warn('a candidate source did not load:', r.reason);
    return settled.flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .map(properties => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [properties.lon, properties.lat] },
            properties,
        }));
}

// ── state: viewport sweep + per-plume selection, merged for display ──

let viewFeats = [], plumeFeats = [], hlIds = new Set();
let sweepEpoch = 0, plumeEpoch = 0, swept = null;

function render() {
    const seen = new Set(), features = [];
    for (const f of [...plumeFeats, ...viewFeats]) {
        if (seen.has(f.properties.id)) continue;
        seen.add(f.properties.id);
        f.properties.hl = hlIds.has(f.properties.id);
        features.push(f);
    }
    map.getSource('candidates')?.setData({ type: 'FeatureCollection', features });
}

// viewport sweep — refetch on moveend unless still inside the padded rect
async function sweep() {
    if (map.getZoom() < MIN_ZOOM) {
        if (viewFeats.length) { viewFeats = []; swept = null; render(); }
        return;
    }
    const b = map.getBounds();
    if (swept && b.getWest() >= swept.minX && b.getEast() <= swept.maxX
              && b.getSouth() >= swept.minY && b.getNorth() <= swept.maxY) return;
    const px = (b.getEast() - b.getWest()) * 0.3, py = (b.getNorth() - b.getSouth()) * 0.3;
    const rect = { minX: b.getWest() - px, minY: b.getSouth() - py, maxX: b.getEast() + px, maxY: b.getNorth() + py };
    const e = ++sweepEpoch;
    const feats = await fetchRect(rect);
    if (e !== sweepEpoch) return;
    viewFeats = feats;
    swept = rect;
    render();
}

// radius query around the selected plume; the rect is stretched to cover the
// attribution's assessed source point so a distant attributed feature
// (coarse-sensor upwind search) still loads, and attributed ids survive both
// the radius cut and the display cap.
export async function selectPlume(lon, lat, radiusKm, rec) {
    hlIds = new Set((rec?.attributed_ids || []).map(normId));
    const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
    const rect = { minX: lon - dLon, minY: lat - dLat, maxX: lon + dLon, maxY: lat + dLat };
    if (rec?.lat != null) {
        rect.minX = Math.min(rect.minX, rec.lon - 0.02); rect.maxX = Math.max(rect.maxX, rec.lon + 0.02);
        rect.minY = Math.min(rect.minY, rec.lat - 0.02); rect.maxY = Math.max(rect.maxY, rec.lat + 0.02);
    }
    const e = ++plumeEpoch;
    const feats = await fetchRect(rect);
    if (e !== plumeEpoch) return;
    for (const f of feats) {
        const [flon, flat] = f.geometry.coordinates;
        f.properties.dist = haversineM(lat, lon, flat, flon);
    }
    feats.sort((a, b) => a.properties.dist - b.properties.dist);
    plumeFeats = feats.filter((f, i) =>
        (i < MAX_SHOW && f.properties.dist <= radiusKm * 1000) || hlIds.has(f.properties.id));
    render();
}

export function clearSelection() {
    plumeFeats = [];
    hlIds = new Set();
    render();
}

// ── display ──

export function addCandidateLayers(m, sql) {
    map = m; query = sql;
    for (const c of [PT, HL]) ensureMark(map, `waypoint-${c}`);
    map.addSource('candidates', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // invisible fat twin of the markings: the hover/touch target
    map.addLayer({
        id: 'candidates-hit', type: 'circle', source: 'candidates',
        paint: { 'circle-radius': 12, 'circle-opacity': 0, 'circle-stroke-width': 0 },
    }, 'plumes-carbon-mapper');
    map.addLayer({
        id: 'candidates', type: 'symbol', source: 'candidates',
        layout: {
            'icon-image': ['case', ['get', 'hl'], `waypoint-${HL}`, `waypoint-${PT}`],
            'icon-size': ['case', ['get', 'hl'], 1.4, 0.9],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    }, 'plumes-carbon-mapper');

    hoverPopup(map, 'candidates-hit', p => {
        const kind = (p.kind || '').replace(/_/g, ' ');
        const title = p.name || kind;
        const detail = [kind, p.operator, p.status, p.fuel, p.detail, p.dist != null && fmtMetres(p.dist)]
            .filter(v => v && v !== title).map(escapeHtml).join(' · ');
        return `<span class="dd-title">${escapeHtml(title)}</span>${p.hl ? ' ★' : ''}<br>${detail}<br><span class="dd-secondary">${escapeHtml(p.id)}</span>`;
    });

    map.on('moveend', sweep);
    sweep();
}

// fly-to links in the attribution label (data-fly attribute, delegated)
document.addEventListener('click', e => {
    const a = e.target.closest('[data-fly]');
    if (!a) return;
    e.preventDefault();
    const f = [...plumeFeats, ...viewFeats].find(f => f.properties.id === a.dataset.fly);
    if (f) map?.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 16) });
});
