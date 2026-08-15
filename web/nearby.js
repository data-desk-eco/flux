// the "also here" row — what else the map holds at the open card's place, in
// the window already ticked. it is the reason the two applications merged: a
// flare card that can say the site also vents, and a plume card that can say it
// also burns.
//
// no read. the groups come from collections the session already holds — the
// resident s2 cluster table, the plume read for the window, the flaring source
// on screen — so a card open costs a distance test over rows that are in memory
// either way. a bounding-box read per card open is exactly what this row must
// not cost, which is why a family with nothing resident simply does not appear.

import { showDetail, setOverlapping, coordsOf } from './vendor/cartograph/detail.js';
import { haversineM } from './vendor/cartograph/util.js';

// "here" is the installation, not the neighbourhood: wide enough to cross a vnf
// pixel (750 m) and a coarse sensor's location error, tight enough that two
// entries are the same place.
export const RADIUS_M = 2000;

let map = null;
// (lat, lon) => [{kind, one, many, features, count?, before?}]
let groups = () => [];
export function initNearby(m, fn) { map = m; groups = fn; }

let near = [];   // filled by nearbyHtml, read by wireNearby (html precedes show)

function collect(p) {
    const lat = Number(p.lat), lon = Number(p.lon);
    const out = [];
    for (const g of groups(lat, lon)) {
        const feats = (g.features ?? [])
            .filter(f => !(g.kind === p.kind && String(f.properties.id) === String(p.id)))
            .map(f => { const [flon, flat] = coordsOf(f); return { f, d: haversineM(lat, lon, flat, flon) }; })
            .filter(({ d }) => d <= RADIUS_M)
            .sort((a, b) => a.d - b.d);
        if (!feats.length) continue;
        const n = g.count ? g.count(feats.map(x => x.f)) : feats.length;
        out.push({ ...g, feats, text: `${n} ${n === 1 ? g.one : g.many}` });
    }
    return out;
}

export function nearbyHtml(p) {
    near = collect(p);
    if (!near.length) return '';
    const entries = near.map((g, i) =>
        `<button data-nearby="${i}">${g.text}</button>`).join(', ');
    return `<div class="also-here"><span class="dd-secondary">Also here</span><span>${entries}</span></div>`;
}

// each entry opens the nearest of its group and hands the whole group to the
// card header, so ‹ 1/n › steps the rest from the first click — the grouping
// here is the radius, which is what the entry counted, not cartograph's 10 px
export function wireNearby(el) {
    const gs = near;
    for (const btn of el.querySelectorAll('[data-nearby]'))
        btn.addEventListener('click', () => {
            const g = gs[Number(btn.dataset.nearby)];
            g.before?.();
            map?.easeTo({ center: coordsOf(g.feats[0].f) });
            setOverlapping(g.feats.map(x => x.f));
            showDetail(g.feats[0].f);
        });
}
