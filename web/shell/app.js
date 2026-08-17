// mount(config): assemble the whole app — dom, map, data, sources, layers, key,
// quarters, sliders, detail, table, search — from one declarative config. that
// config is web/config.js, and the schema is documented there and in the README.
//
// this shell was the cartograph library until 2026-08-17, vendored into three
// maps. two of them now forward here, so it lives in the tree it serves: one
// copy, no vendor step, and no generality kept alive for a consumer that no
// longer exists.

import { createMap, addSatellite, wireWorldmap, wireCollapse, hoverPopup } from './map.js';
import { initData, read, meta, sql, fc } from './data.js';
import { buildShell, initKey, wireSliders } from './ui.js';
import { initQuarters } from './quarters.js';
import { initDetail, restorePermalink } from './detail.js';
import { initTable } from './table.js';

// location search: "lat, lon" zooms directly, anything else geocodes via nominatim
function wireSearch(map) {
    const box = document.getElementById('search');
    box.addEventListener('input', () => box.classList.remove('miss'));
    box.addEventListener('keydown', async e => {
        if (e.key !== 'Enter' || !box.value.trim()) return;
        const q = box.value.trim();
        const m = q.match(/^(-?\d+(?:\.\d+)?)[,\s]\s*(-?\d+(?:\.\d+)?)$/);
        if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180)
            return map.flyTo({ center: [+m[2], +m[1]], zoom: 12 });
        const hit = (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`)
            .then(r => r.json()).catch(() => []))[0];
        if (!hit) return box.classList.add('miss');
        const [s, n, w, east] = hit.boundingbox.map(Number);
        map.fitBounds([[w, s], [east, n]], { padding: 40, maxZoom: 14 });
    });
}

// the key's active rows are the whole filter pipeline: each contributes a
// feature-properties predicate, they AND together, and every geojson source is
// re-set to the matching subset — so a clustered source re-clusters to exactly
// the features left visible. ctx.preds is the same list, for an app re-setting
// a source of its own between toggles.
function wireFilters(map, sources, keyPreds, ctx) {
    return function apply(init) {
        const preds = ctx.preds = keyPreds();
        // the sources were just added with the whole collection; re-setting it
        // would re-index and re-cluster every feature for nothing
        if (init && !preds.length) return dispatchEvent(new Event('fx-filters'));
        for (const [id, fc] of Object.entries(sources))
            map.getSource(id)?.setData(preds.length
                ? { ...fc, features: fc.features.filter(f => preds.every(p => p(f.properties))) } : fc);
        dispatchEvent(new Event('fx-filters'));   // the table re-renders in step
    };
}

export async function mount(config) {
    buildShell(config);
    const map = createMap({ hash: 'map', ...config.map });
    wireWorldmap(map, document.getElementById('worldmap'));
    wireCollapse([[['main-collapse', 'main-title'], 'main-panel']]);
    if (config.search) wireSearch(map);
    if (config.data) initData(config.data);

    const ctx = { map, config, read, meta, sql, fc, sources: {} };
    if (config.quarters) ctx.quarters = initQuarters(document.getElementById('quarters'),
        () => config.quarters.onChange?.(ctx), config.quarters.years);
    wireSliders(config, ctx);

    // style.load, not load: sources and layers only need the style sheet, so
    // the data query starts without waiting for the first tiles to paint
    await new Promise(r => (map.isStyleLoaded() ? r() : map.once('style.load', r)));
    if (config.map?.satellite !== false) addSatellite(map);

    // a sources entry is a FeatureCollection or {data, ...geojson source
    // opts} (cluster etc.); consumers always see the plain fc
    ctx.sources = await config.sources(ctx);
    for (const [id, s] of Object.entries(ctx.sources)) {
        map.addSource(id, { type: 'geojson', ...(s.type ? { data: s } : s) });
        ctx.sources[id] = s.data ?? s;
    }
    for (const { hover, ...spec } of config.layers || []) {
        map.addLayer(spec);
        if (hover) hoverPopup(map, spec.id, hover, { click: !config.detail?.layers.includes(spec.id) });
    }

    let applyFilters;
    const key = initKey(map, () => applyFilters());
    applyFilters = wireFilters(map, ctx.sources, key.preds, ctx);
    ctx.setKey = key.set;
    if (config.key) await key.set(config.key(ctx));
    applyFilters(true);

    initDetail(map, config, () => Object.values(ctx.sources).flatMap(s => s.features));
    if (config.table) initTable(ctx);

    await config.ready?.(ctx);
    // only after ready: onShow hooks may depend on handles wired there
    restorePermalink();
    window.flux = ctx;   // console handle
    return ctx;
}
