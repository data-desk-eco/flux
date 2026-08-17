// candidate sources from the provider-owned `infrastructure` tables. which
// providers publish one is the archive's statement, not this file's, and a
// candidate carries no per-provider styling at all — so a fifth source appears
// here on its own.
//
// these belong to an open plume card and to nothing else: one radius query
// around the selected plume, cleared when the card closes. there is no viewport
// sweep — a permanent layer of every structure in view answered a question
// nobody had asked and buried the detections that are the point of the map.
// duckdb applies the bounds against hilbert-clustered lon/lat row groups.
//
// drawn as dd structure markings over an invisible fat hit layer: a triangle
// for a candidate, a diamond for the attributed source, both white — colour on
// this map is measurement, and a candidate is not one.

import { hoverPopup } from '../shell/map.js';
import { objects } from '../shell/archive.js';
import { parquetInput } from '../shell/data.js';
import { degLat, degLon, escapeHtml, fmtMetres, haversineM } from '../shell/util.js';
import { MARK, PIN } from '../layers.js';

const MAX_SCAN = 4000, MAX_SHOW = 300;

// ch4id feature ids are OSM:w<id>; older attributions carry OSM:way/<id>
const normId = id => id.replace(/^OSM:(way|node|relation)\//, (_, t) => `OSM:${t[0]}`);

let map, query;

// one query per object, swept independently, which keeps the property the glob
// was for: a provider that has not published yet costs only its own rows
async function fetchRect(rect) {
    const settled = await Promise.allSettled((await objects('infrastructure').catch(() => [])).map(table => query(`
        select * exclude (geometry, cell)
        from read_parquet(${parquetInput(table)})
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

// ── state: the open card's candidates ──

let shown = [], epoch = 0;

const render = features => map.getSource('candidates')
    ?.setData({ type: 'FeatureCollection', features: shown = features });

// radius query around the selected plume; the rect is stretched to cover the
// attribution's assessed source point so a distant attributed feature
// (coarse-sensor upwind search) still loads, and attributed ids survive both
// the radius cut and the display cap.
export async function selectPlume(lon, lat, radiusKm, rec) {
    const hl = new Set((rec?.attributed_ids || []).map(normId));
    const dLat = degLat(radiusKm * 1000), dLon = degLon(radiusKm * 1000, lat);
    const rect = { minX: lon - dLon, minY: lat - dLat, maxX: lon + dLon, maxY: lat + dLat };
    if (rec?.lat != null) {
        rect.minX = Math.min(rect.minX, rec.lon - 0.02); rect.maxX = Math.max(rect.maxX, rec.lon + 0.02);
        rect.minY = Math.min(rect.minY, rec.lat - 0.02); rect.maxY = Math.max(rect.maxY, rec.lat + 0.02);
    }
    const e = ++epoch;
    const feats = await fetchRect(rect);
    if (e !== epoch) return;
    for (const f of feats) {
        const [flon, flat] = f.geometry.coordinates;
        f.properties.dist = haversineM(lat, lon, flat, flon);
        f.properties.hl = hl.has(f.properties.id);
    }
    feats.sort((a, b) => a.properties.dist - b.properties.dist);
    render(feats.filter((f, i) =>
        (i < MAX_SHOW && f.properties.dist <= radiusKm * 1000) || f.properties.hl));
}

// the epoch bump is the whole point: a closed card must not be repopulated by
// the read it started
export function clearSelection() {
    epoch++;
    render([]);
}

// ── display ──

export function addCandidateLayers(m, sql) {
    map = m; query = sql;
    map.addSource('candidates', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // invisible fat twin of the markings: the hover/touch target
    map.addLayer({
        id: 'candidates-hit', type: 'circle', source: 'candidates',
        paint: { 'circle-radius': 12, 'circle-opacity': 0, 'circle-stroke-width': 0 },
    }, 'plumes');
    map.addLayer({
        id: 'candidates', type: 'symbol', source: 'candidates',
        layout: {
            ...PIN,
            'icon-image': ['case', ['get', 'hl'], MARK.attributed, MARK.candidate],
            // the attributed one is told apart by shape and size, not by a tint
            'icon-size': ['case', ['get', 'hl'], 1.4, 0.9],
        },
    }, 'plumes');

    hoverPopup(map, 'candidates-hit', p => {
        const kind = (p.kind || '').replace(/_/g, ' ');
        const title = p.name || kind;
        const detail = [kind, p.operator, p.status, p.fuel, p.detail, p.dist != null && fmtMetres(p.dist)]
            .filter(v => v && v !== title).map(escapeHtml).join(' · ');
        return `<span class="dd-title">${escapeHtml(title)}</span>${p.hl ? ' ★' : ''}<br>${detail}<br><span class="dd-secondary">${escapeHtml(p.id)}</span>`;
    });
}

// fly-to links in the attribution label (data-fly attribute, delegated)
document.addEventListener('click', e => {
    const a = e.target.closest('[data-fly]');
    if (!a) return;
    e.preventDefault();
    const f = shown.find(f => f.properties.id === a.dataset.fly);
    if (f) map?.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 16) });
});
