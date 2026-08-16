// the s2 flare site body: the shared information rows, chart and dated rows
// over data-desk/detections, plus the two things only this family has — a
// windowed COG read per date, and a CSV of the series the card is listing.

import { MODE, rampRGB } from '../flaring/render.js';
import { fetchS2Detections } from '../flaring/s2archive.js';
import { wgs84ToUtm, utmToWgs84, utmParams } from '../flaring/s2/geo.js';
import { map, current, currentDets, selectedDetection, coords, siteTitle, hasArchive,
         clearCogLayers, drawImage, heatFootprint } from './index.js';

// a url a windowed read can open: l1c products publish jp2, not cog
const isCog = url => typeof url === 'string' && url.startsWith('http')
    && url.includes('.tif') && !url.includes('.jp2');

function copernicusUrl(date) {
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;
    const { lat, lng } = map.getCenter();
    // maplibre renders 512px tiles, so its zoom is one level lower than the
    // 256px slippy zoom copernicus browser (leaflet) expects for the same scale
    const zoom = Math.round(map.getZoom()) + 1;
    return `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${lat}&lng=${lng}&datasetId=S2_L2A_CDAS&fromTime=${encodeURIComponent(from)}&toTime=${encodeURIComponent(to)}&layerId=6-SWIR&upsampling=NEAREST&downsampling=NEAREST&dateMode=SINGLE`;
}

// the archive serves clusters, not imagery, so its rows fall back to the halo
// at the per-date raw point
function footprint(det) {
    if (!det || !current) return;
    const [cLon, cLat] = coords(current);
    const val = det.max_b12 || det.b12_corrected || 0;
    heatFootprint({ lon: det.raw_lon ?? cLon, lat: det.raw_lat ?? cLat, val,
                    radiusM: 45 * Math.sqrt(val), cfg: MODE.s2 });
}

async function loadImagery(det) {
    clearCogLayers();
    if (!det?.cog_b12 || !det.epsg) return void footprint(det);
    if (!isCog(det.cog_b12)) {
        document.querySelector('.event-item.active')?.classList.add('l1c-only');
        return;
    }

    const [flareLon, flareLat] = coords(current);
    const { zone, isNorth } = utmParams(det.epsg);
    const buffer = 250;
    const [flareUtmX, flareUtmY] = wgs84ToUtm(flareLon, flareLat, zone, isNorth);
    const [minX, minY, maxX, maxY] =
        [flareUtmX - buffer, flareUtmY - buffer, flareUtmX + buffer, flareUtmY + buffer];

    document.querySelectorAll('.event-item').forEach(el => el.classList.remove('loading'));
    document.querySelector('.event-item.active')?.classList.add('loading');

    try {
        // dynamic: the s2e COG glue top-level-awaits a 317 KB geotiff build, and
        // a session that never opens an image must not pay for it at page load
        const { openCOG } = await import('../flaring/s2/cog.js');
        // windowed read via that glue — the same I/O path as the detector
        const { image, bbox: imgBbox, width, height, resX, resY } = await openCOG(det.cog_b12);
        const [imgMinX, imgMinY, imgMaxX, imgMaxY] = imgBbox;

        const x0 = Math.max(0, Math.floor((minX - imgMinX) / resX));
        const y0 = Math.max(0, Math.floor((imgMaxY - maxY) / resY));
        const x1 = Math.min(width, Math.ceil((maxX - imgMinX) / resX));
        const y1 = Math.min(height, Math.ceil((imgMaxY - minY) / resY));

        const windowWidth = x1 - x0, windowHeight = y1 - y0;
        if (windowWidth <= 0 || windowHeight <= 0) throw new Error('Outside image bounds');

        const sw = utmToWgs84(imgMinX + x0 * resX, imgMaxY - y1 * resY, zone, isNorth);
        const ne = utmToWgs84(imgMinX + x1 * resX, imgMaxY - y0 * resY, zone, isNorth);

        const rasters = await image.readRasters({
            window: [x0, y0, x1, y1],
            width: Math.min(windowWidth, 256),
            height: Math.min(windowHeight, 256)
        });

        const data = rasters[0];
        const w = rasters.width, h = rasters.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(w, h);

        const scale = 0.0001, offset = -0.1, threshold = 0.6, ceiling = 1.5;
        for (let i = 0; i < data.length; i++) {
            const v = data[i] * scale + offset;
            if (v <= threshold) {
                imgData.data[i * 4 + 3] = 0;
            } else {
                const t = Math.min(1, (v - threshold) / (ceiling - threshold));
                const [r, g, b] = rampRGB(t);
                imgData.data[i * 4] = r;
                imgData.data[i * 4 + 1] = g;
                imgData.data[i * 4 + 2] = b;
                imgData.data[i * 4 + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);

        clearCogLayers();
        drawImage([[sw[0], ne[1]], [ne[0], ne[1]], [ne[0], sw[1]], [sw[0], sw[1]]],
                  canvas.toDataURL(), { border: true, resampling: 'nearest' });
        document.querySelector('.event-item.active')?.classList.remove('loading');
    } catch (err) {
        console.error('Failed to load COG:', err);
        document.querySelector('.event-item.active')?.classList.remove('loading');
    }
}

function downloadCSV() {
    if (!current) return;
    const props = current;
    const [lon, lat] = coords(current);
    const rows = [['facility', 'terminal', 'lat', 'lon', 'date', 'max_b12', 'pixels', 'persistence', 'passes', 'observations']];
    const persistStr = props.persistence != null ? Number(props.persistence).toFixed(4) : '';
    const passStr = props.passes != null ? String(props.passes) : '';
    const obsStr = props.observations != null ? String(props.observations) : '';
    // the rows the card is listing: an archive cluster's dates were fetched,
    // not embedded, so re-reading the feature would export nothing
    for (const det of currentDets) {
        rows.push([
            `"${(props.name || '').replace(/"/g, '""')}"`,
            `"${(props.terminal || '').replace(/"/g, '""')}"`,
            det.raw_lat?.toFixed(6) || lat.toFixed(6),
            det.raw_lon?.toFixed(6) || lon.toFixed(6),
            det.date,
            det.max_b12?.toFixed(4) || '',
            det.pixels || '',
            persistStr,
            passStr,
            obsStr
        ]);
    }
    const csv = rows.map(r => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(props.name || 'flare').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-detections.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export default {
    source: 'detections',
    cfg: MODE.s2,
    passLabel: 'Passes',
    title: p => siteTitle(p, 'Unknown facility'),
    fetch: fetchS2Detections,
    select: loadImagery,
    // archive clusters carry no COG at all, so only a locally detected one can
    // have a date whose product is l1c-only
    l1c: det => !hasArchive && !isCog(det.cog_b12),
    actions: `<button class="dd-btn" id="open-image-btn">Open image</button>
              <button class="dd-btn" id="download-btn">Download CSV</button>`,
    wire(el) {
        el.querySelector('#download-btn').addEventListener('click', downloadCSV);
        el.querySelector('#open-image-btn').addEventListener('click', () => {
            if (current && selectedDetection) window.open(copernicusUrl(selectedDetection.date), '_blank');
        });
    },
};
