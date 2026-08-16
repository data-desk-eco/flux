// marking, ramp and colour policy for every layer on the map — one home, so a
// layer cannot quietly spend colour on something else.
//
// the guidelines give shape the categorising job and reserve colour for
// intensity (pdf:71, 75, 76). so shape alone says whether a feature burned or
// leaked, and colour says only how much: one ramp across both families,
// adjusted red -> orange -> white, low to high (design/ir/cartography.json ->
// markings.intensityRamp, ruling 2026-07-07; the rule is written for markings
// in general, so the quantitative mark inherits it). each layer keeps its own
// value stops behind that ramp — b12 reflectance, radiant heat and kg/h are not
// comparable quantities, and the key states the units per group.

import { map as ddPalette } from './vendor/dd/palette.js';

export const DD = ddPalette.adjusted;
export const RAMP = [DD.red, DD.orange, DD.white];   // low → high intensity

// one size for every marking on the map, growing gently with zoom
export const ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 2, 0.55, 10, 0.8, 14, 1];

// icon-image expression: `mark` stepped low → mid → high through the ramp at
// the layer's own stops. a row the producer gives no value for coalesces to the
// bottom of the ramp, which flattens the colour rather than hiding the feature.
function rampIcon(mark, prop, stops, log = false) {
    const v = ['coalesce', ['get', prop], stops[0]];
    const at = s => log ? Math.log(s + 1) : s;
    return ['step', log ? ['ln', ['+', v, 1]] : v,
        `${mark}-${RAMP[0]}`, at(stops[1]), `${mark}-${RAMP[1]}`, at(stops[2]), `${mark}-${RAMP[2]}`];
}

// flaring: the flare marking, on the instrument's own scale (render.js MODE)
export const flareIcon = cfg => rampIcon('flare', cfg.prop, cfg.stops, cfg.log);

// the key's flaring bands, taken off the same stops the step above breaks at, so
// a row selects exactly the features drawn in its colour — the guarantee the
// methane bands already make. the bottom band is written as a negation for the
// same reason rampIcon coalesces: a site the producer gives no value for reads
// as the foot of the ramp, which is where the map draws it.
export const flareBands = cfg => {
    const [lo, mid, hi] = cfg.stops, v = p => p[cfg.prop];
    return [
        [`${hi}+`, RAMP[2], p => v(p) >= hi],
        [`${mid}`, RAMP[1], p => v(p) >= mid && v(p) < hi],
        [`${lo}`, RAMP[0], p => !(v(p) >= mid)],
    ];
};

// methane: a plume carries a measured rate, so it is a quantitative data point
// and takes the quantitative marking. its stops are the key's band boundaries,
// so what the map draws and what the key filters on are one set of numbers.
const PLUME_STOPS = [1000, 5000, 10000];   // kg/h
export const plumeIcon = rampIcon('quantitative', 'rate_kg_h', PLUME_STOPS);

// the key's rate bands, off those same stops so a band boundary cannot drift
// from the colour the map draws either side of it: kg/h for the filter, t/hr in
// the label because that is the unit the key states. no slider for these — a
// multi-select band filter reads better than a continuous minimum, and it is
// what flaring now does too, on both its scales.
const [LO, MID, HI] = PLUME_STOPS, t = kg => kg / 1000;
export const PLUME_BANDS = [
    [`${t(HI)}+`, HI, null, RAMP[2]],
    [`${t(MID)}–${t(HI)}`, MID, HI, RAMP[1]],
    [`${t(LO)}–${t(MID)}`, LO, MID, RAMP[0]],
    [`< ${t(LO)}`, 0, LO, RAMP[0]],
    ['n/a', null, null, RAMP[0]],   // no rate published — drawn at the ramp's foot
];

// everything the ramp does not colour. shape categorises and white is the
// default state; licence acreage is the one area that spends a colour, because
// two area layers otherwise share one border.
export const MARK = {
    lng: `triangle-${DD.white}`,          // lng terminal
    candidate: `square-${DD.white}`,      // ogim / other infrastructure
    attributed: `diamond-${DD.white}`,    // attributed source candidate
};
export const AREA = { licence: DD.purple };
export const DASH = [2, 2];

// marking ids only expressions name, so styleimagemissing never sees them
export const MARKS = [...RAMP.flatMap(c => [`flare-${c}`, `quantitative-${c}`]), ...Object.values(MARK)];

// every marking layer on this map pins its icon: a detection sits where it was
// measured, so overlap never moves or drops one
export const PIN = { 'icon-size': ICON_SIZE, 'icon-allow-overlap': true, 'icon-ignore-placement': true };
// the rate label beside it, up-and-right (dd label rule), at the 11px every
// map text takes (pdf:77). the face is not Inter: gl text needs sdf glyphs and
// the basemap's font endpoint serves no Inter stack, so this is the closest
// grotesque it does serve. collision behaviour stays per-layer: a point's
// label is optional, a cluster total's is not.
export const RATE_LABEL = { 'text-font': ['Montserrat Regular'], 'text-size': 11,
                            'text-anchor': 'bottom-left', 'text-offset': [0.7, -0.7] };
