// candidate sources around an open plume card, and nowhere else: one radius
// read of every provider's `infrastructure` table, cleared on close. drawn
// white over an invisible fat hit layer — a triangle per candidate, a diamond
// for the attributed source — since colour on this map is measurement.

import { hoverPopup } from '../shell/map.js';
import { objects } from '../shell/archive.js';
import { parquetInput } from '../shell/data.js';
import { degLat, degLon, escapeHtml, fmtMetres, haversineM }
    from '../shell/util.js';
import { MARK, PIN } from '../layers.js';

const MAX_SCAN = 4000, MAX_SHOW = 300;
const AREAS = ['pipeline', 'field', 'oilfield', 'gas_field', 'offshore_field',
               'licence_area', 'licence_block'];

// ch4id's ids are OSM:w<id>; older attributions carry OSM:way/<id>
const normId = id =>
    id.replace(/^OSM:(way|node|relation)\//, (_, t) => `OSM:${t[0]}`);

let map, query, shown = [], epoch = 0;

// one read per object, so a provider that has not published costs only its
// own rows. the tables are hilbert-clustered on lon/lat, so the bounds prune
async function fetchRect({ minX, minY, maxX, maxY }) {
    const tables = await objects('infrastructure').catch(() => []);
    const settled = await Promise.allSettled(tables.map(t => query(`
        select * exclude (geometry, cell)
        from read_parquet(${parquetInput(t)})
        where lon between ${+minX} and ${+maxX}
          and lat between ${+minY} and ${+maxY}
          and kind not in (${AREAS.map(k => `'${k}'`).join(', ')})
        limit ${MAX_SCAN}`)));
    for (const r of settled)
        if (r.status === 'rejected')
            console.warn('a candidate source did not load:', r.reason);
    return settled.flatMap(r => r.value ?? []).map(p => ({
        type: 'Feature', properties: p,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    }));
}

const render = features => map.getSource('candidates')
    ?.setData({ type: 'FeatureCollection', features: shown = features });

// the rect stretches to the attribution's assessed source point, so a distant
// attributed feature still loads, and attributed ids survive both the radius
// cut and the display cap
export async function selectPlume(lon, lat, radiusKm, rec) {
    const hl = new Set((rec?.attributed_ids || []).map(normId));
    const r = radiusKm * 1000, dLat = degLat(r), dLon = degLon(r, lat);
    const rect = { minX: lon - dLon, minY: lat - dLat,
                   maxX: lon + dLon, maxY: lat + dLat };
    if (rec?.lat != null) {
        rect.minX = Math.min(rect.minX, rec.lon - 0.02);
        rect.maxX = Math.max(rect.maxX, rec.lon + 0.02);
        rect.minY = Math.min(rect.minY, rec.lat - 0.02);
        rect.maxY = Math.max(rect.maxY, rec.lat + 0.02);
    }
    const now = ++epoch;
    const feats = await fetchRect(rect);
    if (now !== epoch) return;
    for (const { geometry: { coordinates: [flon, flat] }, properties: p }
         of feats) {
        p.dist = haversineM(lat, lon, flat, flon);
        p.hl = hl.has(p.id);
    }
    feats.sort((a, b) => a.properties.dist - b.properties.dist);
    render(feats.filter((f, i) =>
        (i < MAX_SHOW && f.properties.dist <= r) || f.properties.hl));
}

// the epoch bump keeps a closed card from being refilled by its own read
export function clearSelection() {
    epoch++;
    render([]);
}

export function addCandidateLayers(m, sql, before = 'plumes') {
    map = m; query = sql;
    map.addSource('candidates', { type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'candidates-hit', type: 'circle', source: 'candidates',
        paint: { 'circle-radius': 12, 'circle-opacity': 0,
                 'circle-stroke-width': 0 },
    }, before);
    // the attributed one is told apart by shape and size, not a tint
    map.addLayer({
        id: 'candidates', type: 'symbol', source: 'candidates',
        layout: {
            ...PIN,
            'icon-image': ['case', ['get', 'hl'], MARK.attributed,
                           MARK.candidate],
            'icon-size': ['case', ['get', 'hl'], 1.4, 0.9],
        },
    }, before);

    hoverPopup(map, 'candidates-hit', p => {
        const kind = (p.kind || '').replace(/_/g, ' ');
        const title = p.name || kind;
        const detail = [kind, p.operator, p.status, p.fuel, p.detail,
            p.dist != null && fmtMetres(p.dist)]
            .filter(v => v && v !== title).map(escapeHtml).join(' · ');
        return `<span class="dd-title">${escapeHtml(title)}</span>`
            + `${p.hl ? ' ★' : ''}<br>${detail}<br>`
            + `<span class="dd-secondary">${escapeHtml(p.id)}</span>`;
    });
}

// the attribution label's fly-to links (data-fly, delegated)
document.addEventListener('click', e => {
    const a = e.target.closest('[data-fly]');
    if (!a) return;
    e.preventDefault();
    const f = shown.find(f => f.properties.id === a.dataset.fly);
    if (f) map?.flyTo({ center: f.geometry.coordinates,
                        zoom: Math.max(map.getZoom(), 16) });
});
