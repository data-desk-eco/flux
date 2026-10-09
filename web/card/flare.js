// the s2 flare site body: the series card over data-desk/detections, plus
// what only this family has — the copernicus scene for the selected date, and
// a csv of the series the card is listing.

import { MODE } from '../flaring/render.js';
import { fetchS2Detections } from '../flaring/s2archive.js';
import { map, current, currentDets, selectedDetection, coords, siteTitle }
    from './index.js';
import { heatFootprint } from './overlays.js';

// the heat halo at the selected date's own raw point
function footprint(det) {
    if (!det || !current) return;
    const [cLon, cLat] = coords(current);
    const val = det.max_b12 || 0;
    heatFootprint({ lon: det.raw_lon ?? cLon, lat: det.raw_lat ?? cLat,
                    val, radiusM: 45 * Math.sqrt(val), cfg: MODE.s2 });
}

// the scene itself is one link away, at the day and the place the card is on
function copernicusUrl(date) {
    const { lat, lng } = map.getCenter();
    // maplibre's 512px tiles sit a zoom below copernicus's 256px ones
    const zoom = Math.round(map.getZoom()) + 1;
    return 'https://browser.dataspace.copernicus.eu/?' + new URLSearchParams({
        zoom, lat, lng, datasetId: 'S2_L2A_CDAS', layerId: '6-SWIR',
        fromTime: `${date}T00:00:00.000Z`, toTime: `${date}T23:59:59.999Z`,
        upsampling: 'NEAREST', downsampling: 'NEAREST', dateMode: 'SINGLE',
    });
}

const CSV_COLS = ['facility', 'terminal', 'lat', 'lon', 'date', 'max_b12',
                  'pixels', 'persistence', 'passes', 'observations'];

// the rows the card is listing: a site carries no dates of its own
function downloadCSV() {
    if (!current) return;
    const p = current, [lon, lat] = coords(p);
    const quote = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const fixed = (v, d) => v == null ? '' : Number(v).toFixed(d);
    const rows = currentDets.map(det => [
        quote(p.name), quote(p.terminal),
        fixed(det.raw_lat ?? lat, 6), fixed(det.raw_lon ?? lon, 6),
        det.date, fixed(det.max_b12, 4), det.pixels ?? '',
        fixed(p.persistence, 4), p.passes ?? '', p.observations ?? '',
    ]);
    const csv = [CSV_COLS, ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const slug = (p.name || 'flare').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    a.download = `${slug}-detections.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

export default {
    source: 'detections',
    cfg: MODE.s2,
    instrument: 'Sentinel-2',
    passLabel: 'Passes',
    title: p => siteTitle(p, 'Unknown facility'),
    fetch: fetchS2Detections,
    select: footprint,
    actions: `<dd-btn id="open-image-btn">Open image</dd-btn>
              <dd-btn id="download-btn">Download CSV</dd-btn>`,
    wire(el) {
        const on = (id, fn) => el.querySelector(id)
            .addEventListener('click', fn);
        on('#download-btn', downloadCSV);
        on('#open-image-btn', () => selectedDetection && window.open(
            copernicusUrl(selectedDetection.date), '_blank'));
    },
};
