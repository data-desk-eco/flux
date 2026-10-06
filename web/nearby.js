// the "also here" row: what else the map holds at the open card's place, in
// the ticked window — a flare site that also vents, a plume that also burns.
// no read: the groups come from what the session already holds, so a card
// open costs a distance test over rows in memory, and a family with nothing
// resident does not appear.

import { showDetail, setOverlapping, coordsOf } from './shell/detail.js';
import { haversineM, degLat, degLon } from './shell/util.js';
import { MODE } from './flaring/render.js';
import { residentFlares } from './flaring/s2archive.js';
import { archiveFeature } from './flaring/clustering.js';

// "here" is the installation: wide enough to cross a vnf pixel (750 m) and a
// coarse sensor's error, tight enough that two entries are one place
export const RADIUS_M = 2000;

let ctx = null;
export const initNearby = c => { ctx = c; };

// the s2 sites near a place, off the resident table: the boxed prefilter is
// what lets this run over the whole table on every card open
function nearS2(lat, lon) {
    const rows = residentFlares(), range = ctx.quarters.range();
    if (!rows || !range) return [];
    const dLat = degLat(RADIUS_M), dLon = degLon(RADIUS_M, lat);
    const qKeys = ctx.quarters.keys();
    return rows
        .filter(c => Math.abs(c.lat - lat) <= dLat
            && Math.abs(c.lon - lon) <= dLon
            && c.last_seen >= range.startDate && c.first_seen <= range.endDate
            && !(c.avg_b12 < MODE.s2.floor))
        .map(c => archiveFeature(c, qKeys));
}

// only what the map draws: an entry the key filtered out would offer a card
// the next refresh cannot find, and reselectCurrentFeature closes those
const drawn = fs => (fs ?? [])
    .filter(f => ctx.preds.every(p => p(f.properties)));

// vnf counts looks, because a look is what vnf measures a night in
const groups = (lat, lon) => [
    { kind: 'plume', one: 'methane plume', many: 'methane plumes',
      features: drawn(ctx.sources.plumes?.features) },
    { kind: 'flare', one: 'flare site', many: 'flare sites',
      features: drawn(nearS2(lat, lon)) },
    { kind: 'vnf', one: 'VNF look', many: 'VNF looks',
      features: drawn(ctx.sources.vnf?.features),
      count: fs => fs.reduce((n, f) =>
          n + (f.properties.detection_count || 0), 0) },
];

let near = [];   // nearbyHtml fills it, wireNearby reads it

function collect(p) {
    const lat = Number(p.lat), lon = Number(p.lon);
    const out = [];
    for (const g of groups(lat, lon)) {
        const self = f => g.kind === p.kind
            && String(f.properties.id) === String(p.id);
        const feats = (g.features ?? []).filter(f => !self(f))
            .map(f => {
                const [flon, flat] = coordsOf(f);
                return { f, d: haversineM(lat, lon, flat, flon) };
            })
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
    return `<div class="also-here"><span class="dd-secondary">Also here</span>`
        + `<span>${entries}</span></div>`;
}

// an entry opens the nearest of its group and hands the card header the
// whole group, so ‹ 1/n › steps the rest: the radius, not the shell's 10 px
export function wireNearby(el) {
    const gs = near;
    for (const btn of el.querySelectorAll('[data-nearby]'))
        btn.addEventListener('click', () => {
            const g = gs[Number(btn.dataset.nearby)];
            ctx.map.easeTo({ center: coordsOf(g.feats[0].f) });
            setOverlapping(g.feats.map(x => x.f));
            showDetail(g.feats[0].f);
        });
}
