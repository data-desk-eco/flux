// the selected data desk MARS-S2L probability surface, georeferenced over the
// satellite basemap. the png carries viridis RGBA — the same ramp the plume
// markings read on (layers.js) — and the canonical analysis footprint supplies
// its four image-source corners.

const LAYER = 'dd-plume-probability';   // and its source, which has no other user
let map, epoch = 0, objectUrl = null;

export function initProbabilityOverlay(value) {
    map = value;
}

export function clearProbabilityOverlay() {
    epoch++;
    if (!map) return;
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(LAYER)) map.removeSource(LAYER);
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
}

// the png's alpha tracks probability, whose floor is ~0.25 (alpha 64) — a
// visible chip-shaped tint over the basemap. remap 64→0, 255→255 so the
// background is fully transparent and the plume ramps in smoothly.
async function transparentize(url) {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const d = image.data;
    for (let i = 3; i < d.length; i += 4) d[i] = Math.max(0, (d[i] - 64) * 255 / 191);
    context.putImageData(image, 0, 0);
    return URL.createObjectURL(await canvas.convertToBlob());
}

function imageCorners(bounds) {
    const ring = JSON.parse(bounds)?.coordinates?.[0];
    if (!ring || ring.length < 4) return null;
    // the canonical chip ring: lower-left, lower-right, upper-right, upper-left
    return [ring[3], ring[2], ring[1], ring[0]];
}

export async function showProbabilityOverlay(properties, url) {
    clearProbabilityOverlay();
    if (!map || properties.provider !== 'data-desk' || !url || !properties.bounds) return;
    const now = epoch;
    try {
        const coordinates = imageCorners(properties.bounds);
        if (!coordinates) return;
        const blobUrl = await transparentize(url);
        if (now !== epoch) return URL.revokeObjectURL(blobUrl);   // superseded mid-fetch
        objectUrl = blobUrl;
        map.addSource(LAYER, { type: 'image', url: blobUrl, coordinates });
        map.addLayer({
            id: LAYER,
            type: 'raster',
            source: LAYER,
            paint: {
                'raster-opacity': 0.85,
                'raster-fade-duration': 0,
                'raster-resampling': 'linear',
            },
        }, map.getLayer('plumes') ? 'plumes' : undefined);
    } catch (error) {
        clearProbabilityOverlay();
        console.warn('probability overlay unavailable:', error);
    }
}
