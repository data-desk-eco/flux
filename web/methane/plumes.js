// the plume reader — every provider's detections for one date window, read
// straight from the archive's detection tables. symmetric with flaring's
// s2archive.js and vnf.js: it reads, and knows nothing about the map.
//
// firedamp read every provider's whole plume history, ~70k features. the window
// goes into duckdb as a date predicate instead, so the first read covers one
// window and the quarter grid re-reads — row group statistics make that cheap,
// and it is a straight improvement whichever window you pick.

import { read, fc } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { canon, quarterOf } from '../shell/util.js';
import { loadAttributions } from './attribution.js';

// everything the map, key and detail panel read — the projection stays narrow
// because every column rides into the geojson. `kind` earns its place twice: it
// is what the key's rate bands and the detail card dispatch on.
const PLUME_COLS = ['id', 'kind', 'provider', 'date', 'lat', 'lon', 'rate_kg_h',
    'rate_std_kg_h', 'satellite', 'sector', 'link', 'overlay', 'bounds'];
// Nature Trace extension columns (a ppm·m modeled enhancement, not a mass rate).
// a second provider omits them rather than writes null, so they are only selected
// over a union of all providers, never per provider — an object without them
// would otherwise fail the SELECT. the display read unions to carry them; the
// fallback, and the availability index, read base columns only.
const PLUME_EXT_COLS = ['observed_enh', 'confidence', 'cluster_size'];
// `detections` holds flares as well as plumes, and a data-desk retrieval the
// producer does not trust rides along with valid = false
const PLUME_WHERE = { kind: ['plume', 'plume'], valid: [true, true] };
export const isPlume = p => p.kind === 'plume';

// a label is editorial, so it is stated here. which providers exist is not: a
// provider the archive adds lands on the map under its own name. provider is no
// longer a colour — colour means intensity everywhere on this map (layers.js).
const LABEL = { 'carbon-mapper': 'Carbon Mapper', imeo: 'IMEO / MARS', sron: 'SRON', ghgsat: 'GHGSat', 'data-desk': 'Data Desk' };
export const label = p => LABEL[p] ?? p;

// null when the provider published no rate estimate
export const rateT = p => p.rate_kg_h == null ? null : (Number(p.rate_kg_h) / 1000).toFixed(1);
// the Nature Trace modeled methane enhancement, in ppm·m, when the provider
// published no mass rate. kept apart from rateT so a ppm·m value is never read
// as a t/hr rate.
export const enhT = p => p.observed_enh == null ? null : Number(p.observed_enh).toFixed(0);

// the private deploy bakes one plumes parquet (it is the only build carrying
// ghgsat); the public one reads whatever the archive index names
let _private = false;
export const initPlumes = isPrivate => { _private = isPrivate; };

// the objects, named from the index. read as one unioned set (union_by_name)
// so a provider-extension column is null where a provider lacks it, rather than
// failing that provider's read — which would silently drop every other provider
// from the map. eog is not among them because the index says its detections are
// partitioned, not because this file knows anything about eog.
const plumeObjects = () => _private ? Promise.resolve(['plumes'])
    : objects('detections').catch(err => (console.warn('archive index:', err), []));

async function readAll(opts, { ext = false } = {}) {
    const objs = await plumeObjects();
    const columns = ext ? [...opts.columns, ...PLUME_EXT_COLS] : opts.columns;
    // one unioned read: union_by_name fills a missing extension column with null.
    // if it fails (a provider object is transiently absent), fall back to reading
    // each object separately on base columns, so that provider's rows alone go.
    try {
        return await read(objs, { ...opts, columns });
    } catch (err) {
        console.warn('plume union read failed — reading per object:', err);
    }
    const reads = await Promise.allSettled(objs.map(u => read(u, { ...opts, columns: opts.columns })));
    for (const r of reads)
        if (r.status === 'rejected') console.warn('a detections source did not load:', r.reason);
    return reads.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// the display read: one window, with ch4id's attributions stamped on
export async function readPlumes(startDate, endDate) {
    const rows = await readAll({ columns: PLUME_COLS, where: { ...PLUME_WHERE, date: [startDate, endDate] } }, { ext: true });
    const attribs = await loadAttributions();
    for (const p of rows) if (attribs.has(canon(p.id))) p.attr = 1;
    return rows;
}

// availability has to answer for quarters the ticked window does not cover, so
// it cannot come off the display read. one read of three columns over the whole
// grid span, held for the session — the shape s2archive.js uses for the flares
// table — and every viewport is then answered from memory. the span alone would
// not do: the plume tables hold something in every quarter of the grid, so a
// global answer greys nothing and the dot state stops meaning anything.
let _index = null;
const plumeIndex = (start, end) => _index ??=
    readAll({ columns: ['date', 'lat', 'lon'], where: { ...PLUME_WHERE, date: [start, end] } })
        .catch(err => (console.warn('plume availability:', err), []));

export async function availableQuartersPlumes([w, s, e, n], start, end) {
    const qs = new Set();
    for (const p of await plumeIndex(start, end))
        if (p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n) qs.add(quarterOf(p.date));
    return qs;
}

// the display read is narrowed to the ticked window, so a link naming a plume
// outside it needs its own read — one row, and the id predicate is a straight
// equality the engine pushes down.
export async function readPlume(id) {
    const row = (await readAll({ columns: PLUME_COLS, where: { ...PLUME_WHERE, id: [id, id] } }, { ext: true }))[0];
    const feature = row ? fc([row]).features[0] : null;
    // a deep-linked plume read the extension columns over the union, so its card
    // carries the enhancement and confidence like the display read
    return feature;
}
