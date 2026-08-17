// the s2 archive reader — the data desk sentinel-2 flare tables, read straight
// from the CloudFerro public parquet archive. `data-desk/flares` is one row per
// cluster and `data-desk/detections` the per-date series behind it, read per
// cluster on card open. neither is named here: the archive index says which
// object each is, and whether it is partitioned. both are one object today, and
// the archive partitions a table past 250 MB on `cell` — an H3 index a reader
// calculates from a position rather than discovers by listing — so passing the
// cluster's cell is what keeps this reader correct on the day either splits.
// `data-desk/coverage.geojson` gives the scanned AOI boxes the intro modal
// draws; it is a named asset, not a table, so it stays named.

import { read } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { quarterOf } from '../shell/util.js';

let _base = '', _coverage = null, _initPromise = null, _flares = null, _rows = null;
const inBox = ([w, s, e, n], c) => c.lon >= w && c.lon <= e && c.lat >= s && c.lat <= n;

// resolves once the coverage geojson has been fetched
export const whenCovered = () => _initPromise ?? Promise.resolve();

// the published scanned-AOI boxes, for the intro modal's worldmap. polygons
// only: the file states a flare AOI as a bare point, and the shell's featureBbox
// walks a ring — the first of the 110 points threw out of the worldmap callback
// and left the intro modal with no coverage drawn at all. null until it lands.
export function coverageTiles() {
    const features = _coverage?.features.filter(f => f.geometry?.type === 'Polygon'
        || f.geometry?.type === 'MultiPolygon') ?? [];
    return features.length ? { ..._coverage, features } : null;
}

// remember the archive base url, start the whole-table read, and fetch the
// coverage geojson (memoized). the two are independent: a missing coverage file
// costs the modal its worldmap and nothing else.
export function initS2Archive(base) {
    _base = base.replace(/\/$/, '');
    // the whole table is one object, so start pulling it here rather than on the
    // first viewport: it downloads while maplibre loads its style and tiles
    flares().catch(err => console.error('S2 archive warm-up failed:', err));
    return _initPromise ??= fetch(`${_base}/data-desk/coverage.geojson`)
        .then(r => r.json())
        .then(g => { _coverage = g; })
        .catch(err => console.warn('S2 coverage failed, no worldmap boxes:', err));
}

// one object for the whole table, so read it once and hold the rows: every
// viewport and quarter indicator is then served from memory, where the old
// per-tile cache served only the tiles a viewport had already touched.
const flares = () => _flares ??= objects('flares', { provider: 'data-desk' })
    .then(([u]) => {
        // the archive partitions a table past 250 MB, and objects() then names
        // nothing without a key — this whole-table read would quietly become
        // zero rows and a blank map. it has to be the loud kind of broken.
        if (!u) throw new Error('data-desk/flares names no object: the table has partitioned '
            + 'and this reader must address it by cell');
        return read(u);
    })
    .then(rows => (_rows = rows))
    .catch(err => { _flares = null; throw err; });

// the rows that whole-table read landed, for callers that need them without
// awaiting — the card's "also here" row. null until it lands.
export const residentFlares = () => _rows;

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

// the `year_quarter` keys with any detection in the viewport, over all dates
export async function availableQuartersS2(bbox) {
    const qs = new Set();
    for (const c of await flares())
        if (inBox(bbox, c))
            // the quarters list carries the count the nested date list used to
            // be counted from, so this no longer walks every detection
            for (const q of c.quarters ?? []) if (q.detections > 0) qs.add(quarterOf(q.quarter));
    return qs;
}

// the per-date history for one cluster (card open). the flares row carries a
// detection count, not a list, so the dates come from data-desk/detections — one
// object today, filtered to this site. rows there are written in
// (cell, site_id, date) order, so passing the cluster's own `cell` alongside its
// id prunes row groups off the footer instead of scanning the table; the same
// cell addresses the object if the table ever partitions, and the index says
// which of the two it is. `kind` is in the predicate because this provider
// writes its methane plumes to the same table.
export async function fetchS2Detections({ id, cell }) {
    if (!id) return [];
    const [detections] = await objects('detections', { provider: 'data-desk', key: cell });
    // the day this table partitions, a card with no cell names no object — and
    // read(undefined) is a worse way to say so. vnf.js guards the same way.
    if (!detections) return [];
    const rows = await read(detections,
        { columns: ['date', 'lat', 'lon', 'max_b12', 'pixels'],
          where: { site_id: [String(id), String(id)], kind: ['flare', 'flare'],
                   ...(cell ? { cell: [cell, cell] } : {}) } });
    return rows.map(r => ({
        date: String(r.date).slice(0, 10),
        max_b12: Number(r.max_b12), pixels: Number(r.pixels),
        raw_lon: Number(r.lon), raw_lat: Number(r.lat),
    })).sort((a, b) => a.date < b.date ? -1 : 1);
}
