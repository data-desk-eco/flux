// the map: maplibre on the dd dark basemap with a globe, markings loaded on
// demand, a grey satellite underlay, the mollweide worldmap and hover popups.

import { addMarking } from '../vendor/dd/markings.js';
import { drawWorldmap, setBoxes } from '../vendor/dd/worldmap.js';

const DD = new URL('../vendor/dd/', import.meta.url);

// styleimagemissing loads any `<name>-<#hex>` a layer names, so layers need
// not wait; ensureMark preloads the ids only expressions name
const loading = new WeakMap();
export function createMap(opts = {}) {
    const map = new maplibregl.Map({ container: 'map',
        style: new URL('style.dark.json', DD).href, ...opts });
    map.on('style.load', () => map.setProjection({ type: 'globe' }));
    loading.set(map, new Set());
    map.on('styleimagemissing', e => ensureMark(map, e.id));
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
    const m = id.match(/^([a-z]+)-(#[0-9A-Fa-f]{6})$/);
    const ids = loading.get(map);
    if (!m || !ids || ids.has(id)) return;
    ids.add(id);
    addMarking(map, m[1], { color: m[2], base: new URL('markings/', DD) })
        .catch(() => ids.delete(id));
}

// grey, underexposed imagery fading in over the basemap (dd: a grayscale
// gradient map, approximated by desaturating under a brightness ceiling).
//
// esri's cache stops between z17 and z19 by place — 26% of 700 measured sites
// have nothing at z18, 53% nothing at z19 — and past it answers 200 with an
// opaque placeholder jpeg, which maplibre paints rather than overzooming. so
// the placeholder (and a 404) becomes a transparent tile, and the source is
// stacked at the three depths the cache stops at: the sharpest that resolved
// shows through.
const ESRI = 'esri://server.arcgisonline.com/ArcGIS/rest/services/'
    + 'World_Imagery/MapServer/tile/{z}/{y}/{x}';
const GAP = 2521;   // byte length of the placeholder jpeg
const BLANK = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA'
    + 'fFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='),
    c => c.charCodeAt(0)).buffer;
const SAT = [['satellite', 7, 17], ['satellite-mid', 17, 18],
             ['satellite-deep', 18, 19]];

maplibregl.addProtocol('esri', async ({ url }, abort) => {
    const res = await fetch(url.replace('esri:', 'https:'),
        { signal: abort.signal });
    if (!res.ok) return { data: BLANK };
    const data = await res.arrayBuffer();
    return { data: data.byteLength === GAP ? BLANK : data };
});

export function addSatellite(map) {
    for (const [id, minzoom, maxzoom] of SAT) {
        map.addSource(id,
            { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom });
        map.addLayer({
            id, type: 'raster', source: id, minzoom,
            paint: {
                'raster-saturation': -1,
                'raster-brightness-max': 0.75,
                'raster-opacity':
                    ['interpolate', ['linear'], ['zoom'], 7.5, 0, 9, 1],
            },
        });
    }
}

// darker still while an image overlay is up
export const dimSatellite = (map, dim) => SAT.forEach(([id]) => map
    .setPaintProperty(id, 'raster-brightness-max', dim ? 0.25 : 0.75));

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

// the dd popup, up and right of the marking, on hover and (for touch) click.
// layers register per map, so coincident features show one popup, topmost
const hoverLayers = new WeakMap();
export function hoverPopup(map, layer, html, { click = true } = {}) {
    if (!hoverLayers.has(map)) hoverLayers.set(map, []);
    const layers = hoverLayers.get(map);
    layers.push(layer);
    const popup = new maplibregl.Popup({
        closeButton: false, closeOnClick: false, className: 'dd-popup',
        anchor: 'bottom-left', offset: 10,
    });
    const show = e => {
        const top = map.queryRenderedFeatures(e.point, { layers })[0];
        if (top?.layer.id !== layer) return popup.remove();
        popup.setLngLat(e.lngLat).setHTML(html(top.properties)).addTo(map);
    };
    map.on('mousemove', layer, e => {
        map.getCanvas().style.cursor = 'pointer';
        show(e);
    });
    if (click) map.on('click', layer, show);
    map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
    });
    return popup;
}

// the chevron and the heading both collapse a panel (dd heading rule)
export function wireCollapse(ids, panel) {
    for (const id of ids) document.getElementById(id)?.addEventListener(
        'click', () => document.getElementById(panel)
            .classList.toggle('collapsed'));
}
