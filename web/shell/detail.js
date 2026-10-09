// the detail card: click to select, ‹ n/N › through overlapping features,
// #<key>=<id> permalinks, and a highlight box round the selection.
//
// config.detail: {
//   layers: [pickable layer ids],
//   hashKeys: {key: resolve},  permalink keys in read order, each with the
//                              resolver for an id no loaded feature carries
//   hashKey: p => key,         the key a selection writes
//   idProp: 'id',
//   flyZoom: 15,               zoom floor on select
//   highlightZoom: 10,         zoom the highlight box appears from
//   title: p => ({text}),       never a link: the heading collapses the card
//   stats: p => rows html,      under the heading rule, after the coordinates
//   html: p => body html,
//   onShow: (p, el) => {},
//   onClose: () => {},
// }

import { escapeHtml, fmtCoords, readHashKeys, writeHashKeys } from './util.js';
import { mark } from '../vendor/dd/dd.js';

let map, cfg, allFeatures;
let overlapping = [], overlapIndex = 0;
let shown = null;   // {feature, n, i}: the card on screen and its position

const panel = () => document.getElementById('detail');
const idOf = f => String(f.properties[cfg.idProp || 'id']);
const keys = () => Object.keys(cfg.hashKeys);
const flyTo = center => map.flyTo({ center,
    zoom: Math.max(map.getZoom(), cfg.flyZoom ?? 15) });

// properties are exact; geometry is quantised by the tile grid at low zoom
export const coordsOf = f => f.properties.lon != null
    ? [Number(f.properties.lon), Number(f.properties.lat)]
    : f.geometry.coordinates;

function setHash(id, key) {
    const target = writeHashKeys(location.hash, keys(), key, id);
    if (location.hash !== target) history.replaceState(null, '',
        target || location.pathname + location.search);
}

// rendered features within 10px, nearest first: a click and a restored
// permalink group overlaps the same way
function featuresAt(point, { lng, lat }) {
    const box = [[point.x - 10, point.y - 10], [point.x + 10, point.y + 10]];
    const layers = cfg.layers.filter(l => map.getLayer(l)
        && map.getLayoutProperty(l, 'visibility') !== 'none');
    const d = f => Math.hypot(f.geometry.coordinates[0] - lng,
        f.geometry.coordinates[1] - lat);
    return map.queryRenderedFeatures(box, { layers })
        .sort((a, b) => d(a) - d(b));
}

const setHighlight = features => map.getSource('fx-highlight')
    ?.setData({ type: 'FeatureCollection', features });

// a feature from a source has real values; one from a click has nested values
// as json and nulls dropped. compare in the form both agree on
const norm = v => v == null ? ''
    : typeof v === 'object' ? JSON.stringify(v) : String(v);
const sameProps = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .every(k => norm(a[k]) === norm(b[k]));

// an app opening a card from its own grouping hands the group over, so the
// header's ‹ n/N › works from the first click
export const setOverlapping = (features, i = 0) => {
    overlapping = features;
    overlapIndex = i;
};

// apps hand the current feature back on every re-read (a resize fires
// moveend too). an unchanged card is not re-rendered, which would drop
// whatever the reader had selected inside it.
export function showDetail(feature, fromPermalink) {
    if (shown && shown.n === overlapping.length && shown.i === overlapIndex
        && sameProps(shown.feature.properties, feature.properties)) return;
    render(feature, fromPermalink);
}

// rebuild in place, for a body that reads state outside the feature
export function refreshDetail() {
    if (shown) render(shown.feature, true);
}

function render(feature, fromPermalink) {
    const p = feature.properties, id = p[cfg.idProp || 'id'];
    if (!fromPermalink && id != null) setHash(id, cfg.hashKey(p));
    const [lon, lat] = coordsOf(feature);
    setHighlight([{ type: 'Feature', properties: {},
        geometry: { type: 'Point', coordinates: [lon, lat] } }]);

    // the heading opens and shuts the card, so it is never a link (ruling
    // 2026-07-08): a body that has one puts it in itself. a long one ends in
    // an ellipsis (dd.js) and the tooltip carries it whole
    const t = cfg.title?.(p) || { text: id }, n = overlapping.length;
    const nav = n < 2 ? '' : ` <span class="fx-overlap">`
        + `<button class="fx-nav" data-nav="-1">‹</button> `
        + `${overlapIndex + 1} / ${n} `
        + `<button class="fx-nav" data-nav="1">›</button></span>`;
    const el = panel();
    el.innerHTML = `
        <span slot="title" title="${escapeHtml(t.text)
            }">${escapeHtml(t.text)}</span>
        <div slot="subtitle" class="fx-sub"><span>${fmtCoords(lat, lon)
            }${nav}</span><div class="fx-stats">${cfg.stats?.(p) || ''
            }</div></div>
        ${cfg.html?.(p) || ''}`;
    el.classList.add('visible');
    shown = { feature, n, i: overlapIndex };
    cfg.onShow?.(p, el);
}

export function closeDetail() {
    if (!panel().classList.contains('visible')) return;
    shown = null;
    setOverlapping([]);
    setHash(null);
    setHighlight([]);
    panel().classList.remove('visible');
    cfg.onClose?.();
}

// open the hash's selection, resolving an id no loaded feature carries, then
// regroup its overlaps once the camera settles. mount() runs it after ready,
// whose handles onShow may use
export async function restorePermalink() {
    if (!cfg) return;
    const [key, id] = readHashKeys(location.hash, keys());
    if (!id) return;
    const match = allFeatures().find(f => idOf(f) === id)
        ?? await cfg.hashKeys[key]?.(id);
    if (!match) return;
    showDetail(match, true);
    const [lon, lat] = coordsOf(match);
    flyTo([lon, lat]);
    map.once('moveend', () => {
        const features = featuresAt(map.project([lon, lat]), { lng: lon, lat });
        // the resolved feature's id, not the link's: an old link may name
        // a spelling the feature no longer carries
        const idx = features.findIndex(f => idOf(f) === idOf(match));
        if (features.length < 2 || idx < 0) return;
        setOverlapping([features[idx],
            ...features.filter((_, i) => i !== idx)]);
        showDetail(overlapping[0], true);
    });
}

export function initDetail(m, config, getFeatures) {
    map = m;
    cfg = config.detail;
    allFeatures = getFeatures;
    if (!cfg) return;

    // the dd heavy-stroke box round the selection, from highlightZoom: below
    // it a selection is carried by its own marking
    mark(map, 'highlight');
    map.addSource('fx-highlight', { type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'fx-highlight', type: 'symbol', source: 'fx-highlight',
        minzoom: cfg.highlightZoom ?? 0,
        layout: { 'icon-image': 'highlight-#FFFFFF', 'icon-size': 1.2,
                  'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });

    map.on('click', e => {
        const features = featuresAt(e.point, e.lngLat);
        if (!features.length) return closeDetail();
        setOverlapping(features);
        showDetail(features[0]);
        flyTo(coordsOf(features[0]));
    });

    const cursor = c => () => { map.getCanvas().style.cursor = c; };
    for (const layer of cfg.layers) {
        map.on('mouseenter', layer, cursor('pointer'));
        map.on('mouseleave', layer, cursor(''));
    }

    panel().addEventListener('click', e => {
        const nav = e.target.closest('[data-nav]'), n = overlapping.length;
        if (nav && n > 1) {
            overlapIndex = (overlapIndex + Number(nav.dataset.nav) + n) % n;
            showDetail(overlapping[overlapIndex]);
        }
    });

    addEventListener('keydown', e => e.key === 'Escape' && closeDetail());

    // a selection writes the hash with replaceState, which fires nothing, so
    // hashchange is outside navigation: re-resolve, or close if it went
    addEventListener('hashchange', () =>
        readHashKeys(location.hash, keys())[1]
            ? restorePermalink() : closeDetail());
}
