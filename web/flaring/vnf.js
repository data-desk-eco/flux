// the vnf (viirs nightfire) reader. eog/flares is one row per site, its
// quarterly history nested in `quarters`, and small enough that the shell
// usually holds it whole; the ticked window is applied over that list here,
// since the shell's where-builder spans scalar columns only.
//
// the nightly series is read per site on card open. eog/detections is
// partitioned on `cell`, which the flares row carries, so a card names one
// object without an H3 library or a bucket listing. eog/observations is never
// read: the quarters list already carries the looks a rate divides by.

import { read, memoised } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { quarterOf } from '../shell/util.js';
import { sumQuarters } from './clustering.js';

let flares = null, opening = null, ready = false;
export const isReady = () => ready;

const COLS = ['id', 'lat', 'lon', 'cell', 'country', 'detail', 'quarters'];
// a quarter key is its first day, so the picker's span selects exactly the
// quarters it ticked
const inWindow = (start, end) => q => q >= start && q <= end;
const inBox = ([w, s, e, n]) => ({ lat: [s, n], lon: [w, e] });

export const initVNF = () => opening ??= objects('flares', { provider: 'eog' })
    .then(([u]) => { flares = u; ready = true; });

// so a failed open is retried on the next pan
export function resetVNF() { opening = flares = null; ready = false; }

const assertReady = () => {
    if (!ready) throw new Error('VNF not initialized');
};

// one feature per site, its quarters summed over the window
function siteFeatures(rows, start, end, { detectedOnly = false } = {}) {
    const keep = inWindow(start, end);
    const sites = [];
    for (const r of rows) {
        const t = sumQuarters(r.quarters, keep);
        if (!t.n) continue;   // nothing in the window
        // lit on any night, cloudy ones included: a flare only ever caught
        // under cloud still burned
        if (detectedOnly && !t.detections) continue;
        sites.push({
            id: r.id, lat: Number(r.lat), lon: Number(r.lon), cell: r.cell,
            country: r.country || '', detail: r.detail || '',
            detection_dates: t.detections_clear, detection_any: t.detections,
            passes: t.observations, observations: t.clear, max_rh: t.rh_max,
            // the share of the window's nights we read the sky for; low means
            // a platform was grounded over the site
            coverage: t.days ? t.observations / t.days : 0,
            // rh_sum spans every detection, cloudy nights included
            avg_rh: t.detections ? t.rh_sum / t.detections : 0,
        });
    }
    sites.sort((a, b) => b.max_rh - a.max_rh);
    return {
        type: 'FeatureCollection',
        features: sites.map(p => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            properties: p,
        })),
    };
}

// the sites in a bbox over a date window
export async function queryVNF(bbox, start, end) {
    assertReady();
    const rows = await read(flares, { columns: COLS, where: inBox(bbox) });
    return siteFeatures(rows, start, end, { detectedOnly: true });
}

// one site by id, for a deep link: nought or one feature
export async function queryVNFFlare(flareId, start, end) {
    assertReady();
    const id = String(flareId);
    const rows = await read(flares, { columns: COLS, where: { id: [id, id] } });
    return siteFeatures(rows, start, end);
}

// the nightly history for one site, whole; the card windows it. every row is
// a night the site was seen lit, so there is nothing to filter
export async function fetchVNFDetections({ id, cell }) {
    if (!id || !cell) return [];
    const [detections] =
        await objects('detections', { provider: 'eog', key: cell });
    if (!detections) return [];
    return memoised(`${detections}#${id}`, async () => {
        const rows = await read(detections, { lane: 'card',
            columns: ['date', 'rh_mw'],
            where: { site_id: [String(id), String(id)] } });
        return rows.map(r => ({ date: String(r.date).slice(0, 10),
                                rh_mw: Number(r.rh_mw) || 0 }))
            .sort((a, b) => a.date < b.date ? -1 : 1);
    });
}

// the quarter keys with any detection in the viewport over [start, end]
export async function availableQuartersVNF(bbox, start, end) {
    if (!ready) return new Set();
    const rows = await read(flares,
        { columns: ['lat', 'lon', 'quarters'], where: inBox(bbox) });
    const keep = inWindow(start, end);
    const qs = new Set();
    for (const r of rows) for (const q of r.quarters ?? [])
        if (q.detections > 0 && keep(q.quarter)) qs.add(quarterOf(q.quarter));
    return qs;
}
