// mapstand oil and gas licence areas. the private deploy bakes the restricted
// hilbert geoparquet locally, and duckdb range-reads only the row groups a
// viewport intersects.

import { hoverPopup } from '../shell/map.js';
import { map as dd } from '../vendor/dd/palette.js';
import { parquetInput } from '../shell/data.js';
import { escapeHtml } from '../shell/util.js';
import { AREA, DASH } from '../layers.js';
import { sweeper } from './sweep.js';

// absolute, because this goes into raw SQL: the data layer resolves a relative
// name only inside read()/meta(), and duckdb treats a bare path as a file it
// has no way to open. dist.sh appends its cache-buster to this path.
// resolved against the document (web/), not this module's directory, so the
// bake stays at web/data/ while the module lives under web/methane/.
const FILE = new URL('data/licences.parquet', document.baseURI).href;
const MIN_LICENCE_ZOOM = 6;   // whole-continent viewports would sweep the world
const MAX_SCAN = 1500;
const C = AREA.licence;

export const LICENCE_LAYERS = ['licences-fill', 'licences-line', 'licences-label'];

let map, query;

async function fetchRect(rect) {
    try {
        const rows = await query(`
            select * exclude geometry, st_asgeojson(geometry) as geometry_json
            from read_parquet(${parquetInput(FILE)})
            where xmin <= ${Number(rect.maxX)} and xmax >= ${Number(rect.minX)}
              and ymin <= ${Number(rect.maxY)} and ymax >= ${Number(rect.minY)}
            limit ${MAX_SCAN}
        `);
        return rows.map(({ geometry_json, ...properties }) => ({
            type: 'Feature', geometry: JSON.parse(geometry_json), properties,
        }));
    } catch (err) { console.warn('licence GeoParquet query failed:', err); }
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
        // dashed: an acreage boundary is a claim on paper, not a thing seen
        paint: { 'line-color': C, 'line-width': 1, 'line-opacity': 0.8, 'line-dasharray': DASH },
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

    const sweep = sweeper(map, MIN_LICENCE_ZOOM, fetchRect, set);
    map.on('moveend', sweep);
    sweep();
}
