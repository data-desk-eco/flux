// MapStand oil and gas licence areas. The private deploy bakes the restricted
// Hilbert GeoParquet locally; DuckDB range-reads only intersecting row groups.

import { hoverPopup } from './vendor/cartograph/shell.js';
import { map as dd } from './vendor/dd/palette.js';
import { escapeHtml } from './vendor/cartograph/util.js';

// absolute, because this goes into raw SQL: cartograph resolves a relative name
// only inside read()/meta(), and DuckDB treats a bare path as a local file it
// has no way to open. dist.sh appends its cache-buster inside the literal.
const FILE = new URL('data/licences.parquet', document.baseURI).href;
const MIN_ZOOM = 6;          // whole-continent viewports would sweep the world
const MAX_SCAN = 1500;
const C = dd.adjusted.purple;

export const LICENCE_LAYERS = ['licences-fill', 'licences-line', 'licences-label'];

let map, query, epoch = 0, swept = null;

// refetch on moveend unless the viewport is still inside the padded rect we
// last swept (same skip rule as the candidate sweep)
async function sweep() {
    if (map.getZoom() < MIN_ZOOM) {
        if (swept) { swept = null; set([]); }
        return;
    }
    const b = map.getBounds();
    if (swept && b.getWest() >= swept.minX && b.getEast() <= swept.maxX
              && b.getSouth() >= swept.minY && b.getNorth() <= swept.maxY) return;
    const px = (b.getEast() - b.getWest()) * 0.3, py = (b.getNorth() - b.getSouth()) * 0.3;
    const rect = { minX: b.getWest() - px, minY: b.getSouth() - py,
                   maxX: b.getEast() + px, maxY: b.getNorth() + py };
    const e = ++epoch;
    let out;
    try {
        const rows = await query(`
            select * exclude geometry, st_asgeojson(geometry) as geometry_json
            from read_parquet('${FILE}')
            where xmin <= ${Number(rect.maxX)} and xmax >= ${Number(rect.minX)}
              and ymin <= ${Number(rect.maxY)} and ymax >= ${Number(rect.minY)}
            limit ${MAX_SCAN}
        `);
        out = rows.map(({ geometry_json, ...properties }) => ({
            type: 'Feature', geometry: JSON.parse(geometry_json), properties,
        }));
    } catch (err) { return void console.warn('licence GeoParquet query failed:', err); }
    if (e !== epoch) return;
    swept = rect;
    set(out);
}

const set = features =>
    map.getSource('licences')?.setData({ type: 'FeatureCollection', features });

export function addLicenceLayers(m, sql) {
    map = m; query = sql;
    map.addSource('licences', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'licences-fill', type: 'fill', source: 'licences',
        paint: { 'fill-color': C, 'fill-opacity': 0.07 },
    });
    map.addLayer({
        id: 'licences-line', type: 'line', source: 'licences',
        paint: { 'line-color': C, 'line-width': 1, 'line-opacity': 0.8 },
    });
    // licence name at the polygon centre, tinted to its boundary. collision
    // drops them where acreage is dense (alberta is 55% of the layer), so they
    // only start once the viewport is tight enough to read
    map.addLayer({
        id: 'licences-label', type: 'symbol', source: 'licences',
        minzoom: 8,
        layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Montserrat Regular'], 'text-size': 10,
        },
        paint: { 'text-color': C, 'text-halo-color': dd.adjusted.black, 'text-halo-width': 1 },
    });

    hoverPopup(map, 'licences-fill', p => {
        const term = [p.start_date, p.end_date].filter(Boolean).join(' – ');
        const detail = [p.operator, p.country, p.shore,
                        p.area_sqkm && `${Number(p.area_sqkm).toLocaleString()} km²`, term]
            .filter(Boolean).map(escapeHtml).join(' · ');
        return `<span class="dd-title">${escapeHtml(p.name || 'Licence area')}</span><br>${detail}`;
    }, { click: false });

    map.on('moveend', sweep);
    sweep();
}
