// the map: maplibre on the dd dark basemap with a globe, markings loaded on
// demand, the graded satellite underlay and the mollweide worldmap.

import { style, mark, marks, imagery } from '../vendor/dd/dd.js';
import { drawWorldmap, setBoxes } from '../vendor/dd/worldmap.js';

// any `<name>-<#hex>` a layer names loads when maplibre asks for it, so
// layers need not wait; ensureMark preloads the ids only expressions name
export function createMap(opts = {}) {
    const map = new maplibregl.Map({ container: 'map', style, ...opts });
    map.on('style.load', () => map.setProjection({ type: 'globe' }));
    marks(map);
    padFor(map, document.querySelector('.fx-main'));
    return map;
}

// the centre sits in the clear area right of the panel, on screens wide
// enough that the panel stands beside the map rather than over it
function padFor(map, el) {
    if (!el) return;
    const pad = () => { const r = el.getBoundingClientRect().right;
        map.setPadding({ left: r < innerWidth / 3 ? r : 0 }); };
    new ResizeObserver(pad).observe(el);
    addEventListener('resize', pad);
}

export function ensureMark(map, id) {
    const [, name, color] = id.match(/^([a-z]+)-(#[0-9A-Fa-f]{6})$/) ?? [];
    if (name) mark(map, name, color).catch(() => {});
}

// the dd satellite underlay: esri, graded to the guidelines' gradient map
// (pdf:62), fading in over the basemap from z7.5
const SAT = new WeakMap();
export function addSatellite(map) {
    SAT.set(map, imagery(map, { id: 'satellite' }));
}

// darker still while an image overlay is up
export const dimSatellite = (map, dim) => SAT.get(map)?.forEach(id => map
    .setPaintProperty(id, 'raster-brightness-max', dim ? 0.35 : 1));

export function viewportBbox(map) {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

// the worldmap with the live viewport as its box (pdf:83)
export function wireWorldmap(map, el) {
    const update = () => setBoxes(el, [viewportBbox(map)]);
    drawWorldmap(el).then(update);
    map.on('move', update);
}

// the worldmap with fixed boxes (pdf:86); getBoxes resolves to bboxes or null
export function boxesWorldmap(el, getBoxes, minSize) {
    drawWorldmap(el).then(async () => {
        const boxes = await getBoxes();
        if (boxes) setBoxes(el, boxes, minSize);
    });
}
