// what a flaring card draws on the map: the markings greyed under it, and a
// heat halo at the selected detection's own point. neither family publishes
// a scene, so the halo is what a selected date draws, coloured and sized by
// intensity on the family's own scale.

import { dimSatellite } from '../shell/map.js';
import { degLat, degLon } from '../shell/util.js';
import { rampRGB, scaleT } from '../flaring/render.js';

const FOOTPRINT = 'detection-footprint';   // the layer id and its source
let map = null;
export const initOverlays = m => { map = m; };

// both flaring layers: imagery under one is imagery under the other
export function greyCircles(grey) {
    for (const id of ['detections', 'vnf'])
        if (map.getLayer(id))
            map.setPaintProperty(id, 'icon-opacity', grey ? 0.35 : 1);
}

function clearFootprint() {
    if (map.getLayer(FOOTPRINT)) map.removeLayer(FOOTPRINT);
    if (map.getSource(FOOTPRINT)) map.removeSource(FOOTPRINT);
}

export function clearOverlays() {
    clearFootprint();
    dimSatellite(map, false);
    greyCircles(false);
}

// a radial gradient, in under 'detections' so both families' markings stay
// above it
export function heatFootprint({ lon, lat, val, radiusM, cfg }) {
    clearFootprint();
    if (!(val > 0)) return;
    const size = 128, half = size / 2;
    const canvas = Object.assign(document.createElement('canvas'),
        { width: size, height: size });
    const ctx = canvas.getContext('2d');
    const [r, g, b] = rampRGB(scaleT(cfg, val));
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    for (const [stop, alpha] of [[0, 0.85], [0.3, 0.5], [0.7, 0.15], [1, 0]])
        grad.addColorStop(stop, `rgba(${r},${g},${b},${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const dLat = degLat(radiusM), dLon = degLon(radiusM, lat);
    map.addSource(FOOTPRINT, { type: 'image', url: canvas.toDataURL(),
        coordinates: [[lon - dLon, lat + dLat], [lon + dLon, lat + dLat],
                      [lon + dLon, lat - dLat], [lon - dLon, lat - dLat]] });
    map.addLayer({ id: FOOTPRINT, type: 'raster', source: FOOTPRINT,
        paint: { 'raster-opacity': 1 } }, 'detections');
    greyCircles(true);
    dimSatellite(map, true);
}
