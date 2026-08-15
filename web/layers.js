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
export function rampIcon(mark, prop, stops, log = false) {
    const v = ['coalesce', ['get', prop], stops[0]];
    const at = s => log ? Math.log(s + 1) : s;
    return ['step', log ? ['ln', ['+', v, 1]] : v,
        `${mark}-${RAMP[0]}`, at(stops[1]), `${mark}-${RAMP[1]}`, at(stops[2]), `${mark}-${RAMP[2]}`];
}

// flaring: the flare marking, on the mode's own scale (render.js MODE)
export const flareIcon = cfg => rampIcon('flare', cfg.prop, cfg.stops, cfg.log);

// methane: a plume carries a measured rate, so it is a quantitative data point
// and takes the quantitative marking. its stops are the key's band boundaries,
// so what the map draws and what the key filters on are one set of numbers.
export const PLUME_STOPS = [1000, 5000, 10000];   // kg/h
export const plumeIcon = () => rampIcon('quantitative', 'rate_kg_h', PLUME_STOPS);

// the key's rate bands in t/hr, each shown in the colour the map draws it in.
// no slider for these: two sliders is the panel budget, and a multi-select band
// filter reads better than a continuous minimum.
export const PLUME_BANDS = [
    ['10+', 10, null, RAMP[2]],
    ['5–10', 5, 10, RAMP[1]],
    ['1–5', 1, 5, RAMP[0]],
    ['< 1', 0, 1, RAMP[0]],
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
export const AREA = { licence: DD.purple, coverage: DD.white };
export const DASH = [2, 2];

// marking ids only expressions name, so styleimagemissing never sees them
export const MARKS = [...RAMP.flatMap(c => [`flare-${c}`, `quantitative-${c}`]), ...Object.values(MARK)];
