// the scale each flaring instrument reads on: the stops the intensity ramp
// steps at (layers.js owns the ramp) and the floor below which a site is not
// drawn. both draw at once, so there is no current mode: a feature carries its
// family and every reader looks its table up.

import { RAMP } from '../layers.js';

// jz-rh calibration for vnf v3 radiant heat (zhizhin et al. 2025, energies
// 18:4765 fig 20). eog's own flow_mcm uses the legacy power law, biased high
// on dim flares and low on bright ones: carry it, never display it.
const RH_TO_MCM = 0.0315;

const fixed = (v, n) => v?.toFixed(n) || '-';

export const MODE = {
    s2: {
        unit: 'B12',
        // a data-desk extension column; flareIcon coalesces a missing one to
        // stops[0], flattening the ramp rather than hiding the site
        prop: 'max_b12',
        // the series table's columns, set from their left as drawn (pdf:89),
        // as wide as their widest value: 0.98, a three-digit count
        col2: 'B12', col3: 'px', cols: '1fr 23px 20px',
        stops: [0.9, 1.15, 1.5],
        log: false,
        chartRange: [0.85, 1.6],
        // the published quality gate, on the site's *average*; the key's bands
        // filter above it on the maximum
        floor: 0.85,
        yVal: d => d.max_b12,
        formatVal: d => fixed(d.max_b12, 2),
        formatCount: d => String(d.pixels || '-'),
        sentinel: null,
    },
    vnf: {
        unit: 'MW',
        prop: 'max_rh',
        col2: 'RH', col3: 'MCM/d', cols: '1fr 27px 38px',
        // no floor: a 3 MW floor hid the lng trains, rare and dim between
        // upsets. the bottom band runs down to the dimmest look
        stops: [3, 7, 20],
        log: true,
        chartRange: [0.5, 50],
        yVal: d => d.rh_mw || 0,
        formatVal: d => d.rh_mw >= 999 ? '-' : fixed(d.rh_mw, 1),
        formatCount: d => d.rh_mw >= 999 || d.rh_mw == null ? '-'
            : (d.rh_mw * RH_TO_MCM).toFixed(2),
        sentinel: 999,
    },
};

const clamp01 = v => Math.max(0, Math.min(1, v));
const logT = (v, lo, hi) =>
    Math.log(Math.max(lo, v) / lo) / Math.log(hi / lo);

// a value on the instrument's scale, stops[0] → stops[2], as 0 → 1
export function scaleT(cfg, val) {
    const [lo, , hi] = cfg.stops;
    return clamp01(cfg.log ? logT(val, lo, hi) : (val - lo) / (hi - lo));
}

// the red → orange → white ramp at t in [0, 1], as rgb
export function rampRGB(t) {
    t = Number.isFinite(t) ? clamp01(t) : 0;
    const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const [a, b] = (t < 0.5 ? RAMP.slice(0, 2) : RAMP.slice(1)).map(hex);
    const f = (t < 0.5 ? t : t - 0.5) * 2;
    return a.map((v, i) => Math.round(v + f * (b[i] - v)));
}

// a value on the chart's y axis, which is wider than the stops
export function chartNorm(cfg, val) {
    const [lo, hi] = cfg.chartRange;
    return cfg.log ? logT(val, lo, hi) : (val - lo) / (hi - lo);
}
