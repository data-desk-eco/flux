// the key: a group per family, each in its own units, and every row a band.
// active rows OR into the data filter and a row is no statement about another
// family (`p.kind !== kind || …`), so one key filters several sources and
// switching a group's rows all off takes that family off the map.

import { AREA, PLUME_BANDS, flareBands } from './layers.js';
import { MODE } from './flaring/render.js';
import { LICENCE_LAYERS } from './methane/licences.js';

const flareSection = (label, kind, cfg) => ({
    label,
    rows: flareBands(cfg).map(([band, color, inBand]) => ({
        swatch: { mark: 'flare', color }, label: band,
        pred: p => p.kind !== kind || inBand(p),
    })),
});

// no row for a plume with no rate: it is drawn, in grey, but in no band. the
// null test matters, as `null >= 0` is true
const inPlumeBand = (lo, hi) => p => p.kind !== 'plume'
    || (p.rate_kg_h != null && p.rate_kg_h >= lo && (!hi || p.rate_kg_h < hi));

// no infrastructure group: candidates belong to an open plume card alone
export const keySections = isPrivate => [
    flareSection(`S2 flaring (${MODE.s2.unit})`, 'flare', MODE.s2),
    flareSection(`VNF flaring (${MODE.vnf.unit})`, 'vnf', MODE.vnf),
    {
        label: 'Methane (t/hr)',
        rows: PLUME_BANDS.map(([label, lo, hi, color]) => ({
            swatch: { mark: 'quantitative', color }, label,
            pred: inPlumeBand(lo, hi),
        })),
    },
    // a layer toggle, not a data filter: licence areas are not detections
    ...(isPrivate ? [{
        label: 'Acreage',
        rows: [{ swatch: { ring: AREA.licence },
                 label: 'Licence areas (MapStand)', toggle: LICENCE_LAYERS }],
    }] : []),
];
