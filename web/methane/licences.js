// mapstand oil and gas licence areas, private build only. the bake is a
// hilbert geoparquet, so duckdb range-reads just the row groups a viewport
// intersects.

import { hoverPopup } from '../shell/map.js';
import { map as dd } from '../vendor/dd/palette.js';
import { parquetInput } from '../shell/data.js';
import { escapeHtml } from '../shell/util.js';
import { AREA, DASH } from '../layers.js';

// absolute, as it goes into raw SQL, and against the document (web/), where
// the bake lives
const FILE = new URL('data/licences.parquet', document.baseURI).href;
const MIN_ZOOM = 6;   // a continent would sweep the world
const MAX_SCAN = 1500;
const C = AREA.licence;

export const LICENCE_LAYERS = ['licences-fill', 'licences-line',
                               'licences-label'];

let map, query;

// null on failure, so the next moveend tries again
async function fetchRect({ minX, minY, maxX, maxY }) {
    try {
        const rows = await query(`
            select * exclude geometry, st_asgeojson(geometry) as geometry_json
            from read_parquet(${parquetInput(FILE)})
            where xmin <= ${+maxX} and xmax >= ${+minX}
              and ymin <= ${+maxY} and ymax >= ${+minY}
            limit ${MAX_SCAN}`);
        return rows.map(({ geometry_json, ...properties }) => ({
            type: 'Feature', geometry: JSON.parse(geometry_json), properties,
        }));
    } catch (err) {
        console.warn('licence query failed:', err);
        return null;
    }
}

const set = features => map.getSource('licences')
    ?.setData({ type: 'FeatureCollection', features });

// refetch on moveend unless the view is still inside the padded rect last
// swept; an epoch so a slow read cannot land after a faster one
function sweeper() {
    let epoch = 0, swept = null;
    return async () => {
        if (map.getZoom() < MIN_ZOOM) {
            if (swept) { swept = null; set([]); }
            return;
        }
        const b = map.getBounds();
        const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(),
                              b.getNorth()];
        if (swept && w >= swept.minX && e <= swept.maxX
                  && s >= swept.minY && n <= swept.maxY) return;
        const px = (e - w) * 0.3, py = (n - s) * 0.3;
        const rect = { minX: w - px, minY: s - py, maxX: e + px, maxY: n + py };
        const now = ++epoch;
        const out = await fetchRect(rect);
        if (now !== epoch || out == null) return;
        swept = rect;
        set(out);
    };
}

export function addLicenceLayers(m, sql) {
    map = m; query = sql;
    map.addSource('licences', { type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'licences-fill', type: 'fill', source: 'licences',
        paint: { 'fill-color': C, 'fill-opacity': 0.07 },
    });
    // dashed: an acreage boundary is a claim on paper, not a thing seen
    map.addLayer({
        id: 'licences-line', type: 'line', source: 'licences',
        paint: { 'line-color': C, 'line-width': 1, 'line-opacity': 0.8,
                 'line-dasharray': DASH },
    });
    // names only once the view is tight enough to read them
    map.addLayer({
        id: 'licences-label', type: 'symbol', source: 'licences', minzoom: 8,
        layout: { 'text-field': ['get', 'name'],
                  'text-font': ['Montserrat Regular'], 'text-size': 10 },
        paint: { 'text-color': C, 'text-halo-color': dd.adjusted.black,
                 'text-halo-width': 1 },
    });

    hoverPopup(map, 'licences-fill', p => {
        const term = [p.start_date, p.end_date].filter(Boolean).join(' – ');
        const area = p.area_sqkm
            && `${Number(p.area_sqkm).toLocaleString()} km²`;
        const detail = [p.operator, p.country, p.shore, area, term]
            .filter(Boolean).map(escapeHtml).join(' · ');
        return `<span class="dd-title">${escapeHtml(p.name || 'Licence area')}`
            + `</span><br>${detail}`;
    }, { click: false });

    const sweep = sweeper();
    map.on('moveend', sweep);
    sweep();
}
