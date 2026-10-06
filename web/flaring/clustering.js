// the two pure feature builders both flaring families go through:
// archiveFeature for an s2 cluster, enrichVNFFeatures for a vnf site, each
// named after the lng terminal it sits on where one is near enough. no app
// state and no dom, so a node test can hold the reducer to its rules.

import { dateInQuarters, degLat, haversineM } from '../shell/util.js';

const TERMINAL_M = 7500, TERMINAL_DEG = degLat(TERMINAL_M);
// vnf: the share of the window's nights we read the sky for. below it a
// platform was grounded over the site, and persistence is not a number we have
const COVERAGE_MIN = 0.8;
// s2: the archive's own floor. a rate off three looks is noise, so below it
// the count is reported and no rate
const MIN_LOOKS = 10;

// the export lng terminals, as {name, lat, lon} rows (terminals.js). a few
// hundred, so a scan is all a lookup needs
let terminals = [];
export const setTerminals = rows => { terminals = rows; };

export function findNearestTerminal(lat, lon) {
    let best = null, bestM = TERMINAL_M;
    for (const t of terminals) {
        if (Math.abs(t.lat - lat) > TERMINAL_DEG) continue;
        const m = haversineM(lat, lon, t.lat, t.lon);
        if (m <= bestM) [best, bestM] = [t, m];
    }
    return best;
}

// the one reducer both families' `quarters` go through, so no caller can
// redefine persistence without changing how it reads. `clear` is the
// cloud-free count a rate divides by, and `detections_clear` the only
// numerator that pairs with it; `observations` is every look. `n` counts the
// quarters kept: 0 means the window measured nothing, not zero.
//
// days, observations and clear count days; detections count rows, so an s2
// rate can pass 1 and its caller clamps.
//
// a field is null unless every kept quarter carried it: summing a null as 0
// turns "we never counted the passes" into "no pass was ever made".
const SUMS = ['days', 'observations', 'clear', 'detections',
              'detections_clear', 'rh_sum'];
export function sumQuarters(quarters, keep) {
    const t = { n: 0, rh_max: 0 }, seen = {};
    for (const k of SUMS) t[k] = seen[k] = 0;
    for (const q of quarters ?? []) {
        if (!keep(q.quarter)) continue;
        t.n++;
        for (const k of SUMS)
            if (q[k] != null) { t[k] += Number(q[k]); seen[k]++; }
        t.rh_max = Math.max(t.rh_max, Number(q.rh_max ?? 0));
    }
    for (const k of SUMS) if (seen[k] < t.n) t[k] = null;
    return t;
}

const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`;

// one data-desk/flares row as a feature, windowed to the ticked quarters,
// rated and named. the producer clustered it; nothing here re-clusters.
export function archiveFeature(c, qKeys = new Set()) {
    const terminal = findNearestTerminal(c.lat, c.lon);
    const t = sumQuarters(c.quarters, q => dateInQuarters(q, qKeys));
    // a producer with no clear-sky pair divides by every pass: a rate a
    // shade low, and `observations` null so the card says cloud-free unknown
    const clear = t.clear != null;
    const detection_count = clear ? t.detections_clear : t.detections;
    const looks = t.n ? (clear ? t.clear : t.observations) : null;
    // clamped: s2 can write several blobs for one site on one day
    const persistence = looks >= MIN_LOOKS
        ? Math.min(1, detection_count / looks) : null;
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
            name: terminal?.name ?? plural(detection_count, 'detection'),
            kind: 'flare',   // the card's body registry dispatches on this
            terminal: terminal?.name ?? null,
            lat: c.lat, lon: c.lon,
            id: c.id, cell: c.cell,
            max_b12: c.max_b12,   // a data-desk extension column
            detection_count, persistence,
            passes: t.n ? t.observations : null,
            observations: clear ? t.clear : null,
            // what the gate ranks on: one quarter puts 90% of sites under
            // MIN_LOOKS, so the published whole-history rate stands in. null,
            // not 0, for a site nothing rated — config.js decides what an
            // unrated site does at the gate, per family
            rank: persistence ?? c.persistence ?? null,
        },
    };
}

// vnf sites as features. there is no intensity floor: a dim, intermittent
// flare is still one
export const enrichVNFFeatures = features => features.map(feat => {
    const p = feat.properties, [lon, lat] = feat.geometry.coordinates;
    const terminal = findNearestTerminal(lat, lon);
    // both counts are clear nights, so the ratio is a rate. null, not 0, where
    // too little was read or no night was clear: never seen is not unlit
    const persistence = p.coverage < COVERAGE_MIN || p.observations === 0
        ? null : p.detection_dates / p.observations;
    return {
        type: 'Feature',
        geometry: feat.geometry,
        properties: {
            name: terminal?.name ?? (p.detail || `Flare #${p.id}`),
            kind: 'vnf',
            terminal: terminal?.name ?? null,
            lat, lon,
            id: p.id, cell: p.cell,
            detail: p.detail || '', country: p.country || '',
            avg_rh: p.avg_rh, max_rh: p.max_rh,
            detection_count: p.detection_dates,
            passes: p.passes, observations: p.observations,
            persistence,
        },
    };
});
