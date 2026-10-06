// the plume reader: every provider's detections for one date window, read
// straight from the archive's detections tables with the window as a date
// predicate, so row-group statistics keep a re-read cheap. it reads, and
// knows nothing about the map.

import { read, fc } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { canon, quarterOf } from '../shell/util.js';
import { loadAttributions } from './attribution.js';

// every column rides into the geojson, so the projection stays narrow
const COLS = ['id', 'kind', 'provider', 'date', 'lat', 'lon', 'rate_kg_h',
    'rate_std_kg_h', 'satellite', 'sector', 'link', 'overlay', 'bounds'];
// extension columns: nature trace's ppm·m enhancement (not a mass rate) and
// grading, and the producer's wind at the plume. a provider without them
// omits them, so they are only selected over the union, which fills null
const EXT = ['observed_enh', 'confidence', 'cluster_size',
    'wind_ms', 'wind_from_deg'];
// `detections` holds flares too, and an untrusted retrieval rides along
// with valid = false
const WHERE = { kind: ['plume', 'plume'], valid: [true, true] };
export const isPlume = p => p.kind === 'plume';
// nature trace grades every plume high or medium; only high is shown. after
// the read, as the shell's `where` would drop the null of other providers
const confident = p => p.confidence == null || p.confidence === 'high';

// colour never means provider here; the label is the only editorial part
const LABEL = { 'carbon-mapper': 'Carbon Mapper', imeo: 'IMEO / MARS',
    sron: 'SRON', ghgsat: 'GHGSat', 'data-desk': 'Data Desk' };
export const label = p => LABEL[p] ?? p;

// t/hr, or null where the provider published no rate
export const rateT = p => p.rate_kg_h == null ? null
    : (Number(p.rate_kg_h) / 1000).toFixed(1);
// nature trace's ppm·m enhancement, kept apart so it is never read as t/hr
export const enhT = p => p.observed_enh == null ? null
    : Number(p.observed_enh).toFixed(0);

// the private build bakes one plumes parquet (the only one carrying ghgsat)
let isPrivate = false;
export const initPlumes = priv => { isPrivate = priv; };

const plumeObjects = () => isPrivate ? Promise.resolve(['plumes'])
    : objects('detections')
        .catch(err => (console.warn('archive index:', err), []));

// one unioned read; if it fails, each object on its own on the base columns,
// so a missing provider costs only its own rows
async function readAll(where, columns = COLS) {
    const objs = await plumeObjects();
    try {
        return (await read(objs, { where, columns: [...columns, ...EXT] }))
            .filter(confident);
    } catch (err) {
        console.warn('plume union read failed, reading per object:', err);
    }
    const reads = await Promise.allSettled(
        objs.map(u => read(u, { where, columns })));
    for (const r of reads)
        if (r.status === 'rejected')
            console.warn('a detections source did not load:', r.reason);
    return reads.flatMap(r => r.value ?? []);
}

// the display read, with ch4id's attributions stamped on
export async function readPlumes(start, end) {
    const rows = await readAll({ ...WHERE, date: [start, end] });
    const attribs = await loadAttributions();
    for (const p of rows) if (attribs.has(canon(p.id))) p.attr = 1;
    return rows;
}

// availability has to answer for quarters outside the ticked window, so it is
// one read of three columns over the grid's span, held for the session
let index = null;
const plumeIndex = (start, end) => index ??=
    readAll({ ...WHERE, date: [start, end] }, ['date', 'lat', 'lon'])
        .catch(err => (console.warn('plume availability:', err), []));

export async function availableQuartersPlumes([w, s, e, n], start, end) {
    const qs = new Set();
    for (const p of await plumeIndex(start, end))
        if (p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n)
            qs.add(quarterOf(p.date));
    return qs;
}

// a link naming a plume outside the window: one row, on an id equality the
// engine pushes down
export async function readPlume(id) {
    const [row] = await readAll({ ...WHERE, id: [id, id] });
    return row ? fc([row]).features[0] : null;
}
