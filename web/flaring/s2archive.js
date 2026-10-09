// the s2 archive reader. data-desk/flares is one row per cluster, read whole
// once and held; data-desk/detections is the per-date series, read per
// cluster on card open. the index names both objects, and passing a cluster's
// `cell` keeps this reader correct the day either partitions on it.

import { read, memoised } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { quarterOf } from '../shell/util.js';

let _flares = null;
const inBox = ([w, s, e, n], c) =>
    c.lon >= w && c.lon <= e && c.lat >= s && c.lat <= n;

// the table is one object, read once and held: every viewport is then served
// from memory. a table partitioned past 250 MB would name no object here, and
// that has to be the loud kind of broken rather than a blank map.
const flares = () => _flares ??= objects('flares', { provider: 'data-desk' })
    .then(([u]) => {
        if (!u) throw new Error('data-desk/flares names no object: it has '
            + 'partitioned, and this reader must address it by cell');
        return read(u);
    })
    .catch(err => { _flares = null; throw err; });

// start the whole-table read at page parse, so it downloads while maplibre
// loads its style and tiles rather than on the first viewport
export const initS2Archive = () => flares()
    .catch(err => console.error('S2 archive warm-up failed:', err));

// what the archive covers, for the intro modal's worldmap: a point per
// tenth of a degree holding a site, which minSize then draws as a box
export async function coverage() {
    const cells = new Map();
    for (const { lat, lon } of await flares())
        cells.set(`${Math.round(lat * 10)},${Math.round(lon * 10)}`,
            [lon, lat, lon, lat]);
    return [...cells.values()];
}

// clusters intersecting a viewport bbox and date window. the window is an
// overlap test on each cluster's [first_seen, last_seen]; the published scalar
// columns are passed through.
export async function queryS2Archive(bbox, startDate, endDate) {
    return (await flares()).filter(c => inBox(bbox, c) &&
        c.last_seen >= startDate && c.first_seen <= endDate);
}

// one cluster row by id, for the family-agnostic #site= permalink. served off
// the same resident table every viewport reads, so it costs no request.
export async function queryS2Flare(id) {
    return (await flares()).find(c => String(c.id) === String(id)) ?? null;
}

// the quarter keys with any detection in the viewport, over all dates
export async function availableQuartersS2(bbox) {
    const qs = new Set();
    for (const c of await flares()) if (inBox(bbox, c))
        for (const q of c.quarters ?? [])
            if (q.detections > 0) qs.add(quarterOf(q.quarter));
    return qs;
}

// one cluster's per-date history. rows are in (cell, site_id, date) order, so
// the cell and id prune row groups off the footer; `kind` because plumes
// share the table. memoised on object and id: reopening a card is free
export async function fetchS2Detections({ id, cell }) {
    if (!id) return [];
    const [detections] =
        await objects('detections', { provider: 'data-desk', key: cell });
    if (!detections) return [];   // partitioned, and no cell to address it by
    const sid = String(id);
    return memoised(`${detections}#${id}`, async () => {
        const rows = await read(detections, { lane: 'card',
            columns: ['date', 'lat', 'lon', 'max_b12', 'pixels'],
            where: { site_id: [sid, sid], kind: ['flare', 'flare'],
                     ...(cell ? { cell: [cell, cell] } : {}) } });
        return rows.map(r => ({
            date: String(r.date).slice(0, 10),
            max_b12: Number(r.max_b12), pixels: Number(r.pixels),
            raw_lon: Number(r.lon), raw_lat: Number(r.lat),
        })).sort((a, b) => a.date < b.date ? -1 : 1);
    });
}
