// one lookup table per flaring instrument — the single source of truth for the
// scale each reads on. what a flare *looks* like is layers.js's business, which
// owns the marking and the intensity ramp; this file supplies the stops that
// ramp steps at, and the floor below which a site is not worth drawing.
//
// both instruments draw at once, so nothing here is "the current mode": a
// feature carries its family, and the card, the key and the layer each read the
// table for it.

import { RAMP } from '../layers.js';

// jz-rh calibration for vnf v3 toa radiant heat (zhizhin et al. 2025, energies
// 18:4765 fig 20): bcm/yr = 0.0115*rh -> mcm/day. metered-flare validated;
// preferred over eog's per-pass Flow_Rate (cedigaz power law, biased high on
// dim flares / low on bright ones per the same paper)
const RH_TO_MCM = 0.0315;

export const MODE = {
    s2: {
        unit: 'B12',
        // the site-level ramp key. the shared flares schema has no b12 column,
        // so this is a data-desk extension on the row, and flareIcon coalesces a
        // missing one to stops[0] — which flattens the ramp rather than hiding
        // the site.
        prop: 'max_b12',
        col2: 'B12', col3: 'px',
        stops: [0.9, 1.15, 1.5],
        log: false,
        chartRange: [0.85, 1.6],
        // the quality floor, on the site's average — the ramp above reads the
        // maximum. it was the intensity slider's default; the slider is gone and
        // the key's colour bands filter above it, so this is now a constant of
        // the archive rather than a control, and the stops start at it.
        floor: 0.85,
        yVal: d => d.max_b12,
        formatVal: d => d.max_b12?.toFixed(2) || '-',
        formatCount: d => String(d.pixels || '-'),
        sentinel: null,
    },
    vnf: {
        unit: 'MW',
        prop: 'max_rh',
        col2: 'RH', col3: 'MCM/d',
        // stops[0] is the floor, so the key's bottom band names the dimmest
        // flare the map draws rather than a number nothing can be under
        stops: [3, 7, 20],
        log: true,
        chartRange: [0.5, 50],
        // 3 MW on the site's average radiant heat, the old slider default
        floor: 3,
        yVal: d => d.rh_mw || 0,
        formatVal: d => d.rh_mw >= 999 ? '-' : (d.rh_mw?.toFixed(1) || '-'),
        formatCount: d => d.rh_mw >= 999 ? '-' : (d.rh_mw != null ? (d.rh_mw * RH_TO_MCM).toFixed(2) : '-'),
        sentinel: 999,
    },
};

// normalise a value to 0→1 on the instrument's intensity scale (stops[0]→stops[2])
export function scaleT(cfg, val) {
    const [lo, , hi] = cfg.stops;
    const raw = cfg.log
        ? Math.log(Math.max(lo, val) / lo) / Math.log(hi / lo)
        : (val - lo) / (hi - lo);
    return Math.max(0, Math.min(1, raw));
}

// red→orange→white ramp, t in [0,1]
export function rampRGB(t) {
    t = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
    const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const [a, b] = t < 0.5 ? [hex(RAMP[0]), hex(RAMP[1])] : [hex(RAMP[1]), hex(RAMP[2])];
    const f = (t < 0.5 ? t : t - 0.5) * 2;
    return a.map((v, i) => Math.round(v + f * (b[i] - v)));
}

// normalise a value to 0→1 on the chart's y axis, which is wider than the stops
export function chartNorm(cfg, val) {
    const [lo, hi] = cfg.chartRange;
    if (cfg.log) return (Math.log(Math.max(lo, val)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    return (val - lo) / (hi - lo);
}
