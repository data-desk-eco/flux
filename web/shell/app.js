// mount(config): the whole app — dom, map, data, sources, layers, key,
// quarters, sliders, detail, table, search — from one declarative config,
// web/config.js.

import { createMap, addSatellite, wireWorldmap, wireCollapse, hoverPopup }
    from './map.js';
import { initData, read, sql, fc } from './data.js';
import { buildShell, initKey, wireSliders } from './ui.js';
import { initQuarters } from './quarters.js';
import { initDetail, restorePermalink } from './detail.js';
import { initTable } from './table.js';

// "lat, lon" flies there; anything else is geocoded by nominatim
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=jsonv2'
    + '&limit=1&q=';
function wireSearch(map) {
    const box = document.getElementById('search');
    box.addEventListener('input', () => box.classList.remove('miss'));
    box.addEventListener('keydown', async e => {
        if (e.key !== 'Enter' || !box.value.trim()) return;
        const q = box.value.trim();
        const m = q.match(/^(-?\d+(?:\.\d+)?)[,\s]\s*(-?\d+(?:\.\d+)?)$/);
        if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180)
            return map.flyTo({ center: [+m[2], +m[1]], zoom: 12 });
        const hit = (await fetch(NOMINATIM + encodeURIComponent(q))
            .then(r => r.json()).catch(() => []))[0];
        if (!hit) return box.classList.add('miss');
        const [s, n, w, east] = hit.boundingbox.map(Number);
        map.fitBounds([[w, s], [east, n]], { padding: 40, maxZoom: 14 });
    });
}

// the key's active rows are the whole filter: their predicates AND together
// and every source is re-set to the matching subset, so a clustered source
// re-clusters to what is left. ctx.preds is the same list, for an app that
// re-sets a source of its own between toggles.
function wireFilters(map, sources, keyPreds, ctx) {
    return function apply(init) {
        const preds = ctx.preds = keyPreds();
        // just added whole: re-setting would re-cluster for nothing
        const changed = () => dispatchEvent(new Event('fx-filters'));
        if (init && !preds.length) return changed();
        for (const [id, fc] of Object.entries(sources))
            map.getSource(id)?.setData(preds.length ? { ...fc, features:
                fc.features.filter(f => preds.every(p => p(f.properties))) }
                : fc);
        changed();   // the table follows
    };
}

export async function mount(config) {
    buildShell(config);
    const map = createMap({ hash: 'map', ...config.map });
    wireWorldmap(map, document.getElementById('worldmap'));
    wireCollapse(['main-collapse', 'main-title'], 'main-panel');
    if (config.search) wireSearch(map);
    if (config.data) initData(config.data);

    const ctx = { map, config, read, sql, fc, sources: {} };
    if (config.quarters) ctx.quarters = initQuarters(
        document.getElementById('quarters'),
        () => config.quarters.onChange?.(ctx), config.quarters.years);
    wireSliders(config, ctx);

    // style.load, not load: layers need the style, not the first tiles
    await new Promise(r =>
        map.isStyleLoaded() ? r() : map.once('style.load', r));
    if (config.map?.satellite !== false) addSatellite(map);

    // an entry is a FeatureCollection or {data, ...source options};
    // ctx.sources always holds the plain collection
    ctx.sources = await config.sources(ctx);
    for (const [id, s] of Object.entries(ctx.sources)) {
        map.addSource(id, { type: 'geojson', ...(s.type ? { data: s } : s) });
        ctx.sources[id] = s.data ?? s;
    }
    for (const { hover, ...spec } of config.layers || []) {
        map.addLayer(spec);
        if (hover) hoverPopup(map, spec.id, hover,
            { click: !config.detail?.layers.includes(spec.id) });
    }

    let applyFilters;
    const key = initKey(map, () => applyFilters());
    applyFilters = wireFilters(map, ctx.sources, key.preds, ctx);
    if (config.key) await key.set(config.key(ctx));
    applyFilters(true);

    initDetail(map, config,
        () => Object.values(ctx.sources).flatMap(s => s.features));
    if (config.table) initTable(ctx);

    await config.ready?.(ctx);
    // after ready: onShow hooks use handles wired there
    restorePermalink();
    window.flux = ctx;   // console handle
    return ctx;
}
