// the s2 flare site body: the shared information rows, chart and dated rows over
// data-desk/detections, plus the two things only this family has — a link to the
// copernicus browser for the selected date, and a csv of the series the card is
// listing.

import { MODE } from '../flaring/render.js';
import { fetchS2Detections } from '../flaring/s2archive.js';
import { map, current, currentDets, selectedDetection, coords, siteTitle,
         heatFootprint } from './index.js';

// the archive publishes clusters, not scenes, so a selected date draws the heat
// halo at that date's own raw point — the same device the vnf body uses
function footprint(det) {
    if (!det || !current) return;
    const [cLon, cLat] = coords(current);
    const val = det.max_b12 || 0;
    heatFootprint({ lon: det.raw_lon ?? cLon, lat: det.raw_lat ?? cLat, val,
                    radiusM: 45 * Math.sqrt(val), cfg: MODE.s2 });
}

// the scene itself is one link away, at the day and the place the card is on
function copernicusUrl(date) {
    const { lat, lng } = map.getCenter();
    // maplibre renders 512px tiles, so its zoom is one level lower than the
    // 256px slippy zoom copernicus browser (leaflet) expects for the same scale
    const zoom = Math.round(map.getZoom()) + 1;
    return 'https://browser.dataspace.copernicus.eu/?' + new URLSearchParams({
        zoom, lat, lng, datasetId: 'S2_L2A_CDAS', layerId: '6-SWIR',
        fromTime: `${date}T00:00:00.000Z`, toTime: `${date}T23:59:59.999Z`,
        upsampling: 'NEAREST', downsampling: 'NEAREST', dateMode: 'SINGLE',
    });
}

const CSV_COLS = ['facility', 'terminal', 'lat', 'lon', 'date', 'max_b12', 'pixels',
                  'persistence', 'passes', 'observations'];

// the rows the card is listing, not the feature's own: an archive cluster's
// dates are fetched on open rather than carried, so re-reading it exports nothing
function downloadCSV() {
    if (!current) return;
    const p = current, [lon, lat] = coords(p);
    const quote = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const fixed = (v, d) => v == null ? '' : Number(v).toFixed(d);
    const rows = currentDets.map(det => [
        quote(p.name), quote(p.terminal), fixed(det.raw_lat ?? lat, 6), fixed(det.raw_lon ?? lon, 6),
        det.date, fixed(det.max_b12, 4), det.pixels ?? '',
        fixed(p.persistence, 4), p.passes ?? '', p.observations ?? '',
    ]);
    const csv = [CSV_COLS, ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${(p.name || 'flare').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-detections.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

export default {
    source: 'detections',
    cfg: MODE.s2,
    passLabel: 'Passes',
    title: p => siteTitle(p, 'Unknown facility'),
    fetch: fetchS2Detections,
    select: footprint,
    actions: `<button class="dd-btn" id="open-image-btn">Open image</button>
              <button class="dd-btn" id="download-btn">Download CSV</button>`,
    wire(el) {
        el.querySelector('#download-btn').addEventListener('click', downloadCSV);
        el.querySelector('#open-image-btn').addEventListener('click', () => {
            if (selectedDetection) window.open(copernicusUrl(selectedDetection.date), '_blank');
        });
    },
};
