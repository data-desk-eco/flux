// marking, ramp and colour policy for every layer on the map — one home, so a
// layer cannot quietly spend colour on something else.
//
// the guidelines give shape the categorising job and reserve colour for
// intensity (pdf:71, 75, 76). so shape alone says whether a feature burned or
// leaked, and colour says only how much — never who published it, never what
// kind of thing it is.
//
// there are two ramps, one per question. flaring takes the adjusted intensity
// ramp, red -> orange -> white, low to high (design/ir/cartography.json ->
// markings.intensityRamp, ruling 2026-07-07), and both instruments read on it
// against their own stops: b12 reflectance and radiant heat are not comparable
// numbers but they are the same question. methane takes viridis, because gas
// released is not gas burned and a shared ramp made the two look like one
// measurement — and because the plume rasters this app drapes are already
// rendered in it. the key states the units of each.

import { map as ddPalette } from './vendor/dd/palette.js';

export const DD = ddPalette.adjusted;
export const RAMP = [DD.red, DD.orange, DD.white];   // low → high intensity

// one size for every marking on the map, growing gently with zoom
const ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 2, 0.55, 10, 0.8, 14, 1];

// icon-image expression: `mark` stepped through `colors` at `breaks` — one more
// colour than break, low to high.
const stepIcon = (mark, value, breaks, colors) => ['step', value, `${mark}-${colors[0]}`,
    ...breaks.flatMap((b, i) => [b, `${mark}-${colors[i + 1]}`])];

// flaring: the flare marking, on the instrument's own scale (render.js MODE).
// a site the producer gives no value for coalesces to the foot of the ramp,
// which flattens the colour rather than hiding the site.
export const flareIcon = cfg => {
    const v = ['coalesce', ['get', cfg.prop], cfg.stops[0]];
    const at = s => cfg.log ? Math.log(s + 1) : s;
    return stepIcon('flare', cfg.log ? ['ln', ['+', v, 1]] : v, cfg.stops.slice(1).map(at), RAMP);
};

// the key's flaring bands, taken off the same stops the step above breaks at, so
// a row selects exactly the features drawn in its colour — the guarantee the
// methane bands make too. the bottom band is written as a negation for the same
// reason flareIcon coalesces: a site the producer gives no value for reads as
// the foot of the ramp, which is where the map draws it.
export const flareBands = cfg => {
    const [lo, mid, hi] = cfg.stops, v = p => p[cfg.prop];
    return [
        [`${hi}+`, RAMP[2], p => v(p) >= hi],
        [`${mid}`, RAMP[1], p => v(p) >= mid && v(p) < hi],
        [`${lo}`, RAMP[0], p => !(v(p) >= mid)],
    ];
};

// methane: a plume carries a measured rate, so it is a quantitative data point
// and takes the quantitative marking. colour is still intensity, but on a ramp
// of its own — viridis, the ramp the data desk plume rasters this app drapes are
// already rendered in (methane/overlay.js). on one shared ramp a bright plume
// and a bright flare read as the same quantity, and they are not comparable at
// all: one is gas burned, the other gas released.
const VIRIDIS = ['#3B528B', '#21918C', '#5EC962', '#FDE725'];   // low → high rate
const PLUME_STOPS = [1000, 5000, 10000];   // kg/h — the key's band boundaries too

// a plume the provider put no number on is drawn in the ui grey, not at the foot
// of the ramp: the ramp's foot is a small release, and an unquantified plume is
// not a small one. the key lists no swatch for it — there is no band to filter.
export const plumeIcon = ['case',
    ['!=', ['typeof', ['get', 'rate_kg_h']], 'number'], `quantitative-${DD.grey}`,
    stepIcon('quantitative', ['get', 'rate_kg_h'], PLUME_STOPS, VIRIDIS)];

// the key's rate bands, off those same stops so a band boundary cannot drift
// from the colour the map draws either side of it: kg/h for the filter, t/hr in
// the label because that is the unit the key states. no slider for these — a
// multi-select band filter reads better than a continuous minimum, and it is
// what flaring now does too, on both its scales.
const [LO, MID, HI] = PLUME_STOPS, t = kg => kg / 1000;
export const PLUME_BANDS = [
    [`${t(HI)}+`, HI, null, VIRIDIS[3]],
    [`${t(MID)}–${t(HI)}`, MID, HI, VIRIDIS[2]],
    [`${t(LO)}–${t(MID)}`, LO, MID, VIRIDIS[1]],
    [`< ${t(LO)}`, 0, LO, VIRIDIS[0]],
];

// everything the ramp does not colour. shape categorises and white is the
// default state; licence acreage is the one area that spends a colour, because
// two area layers otherwise share one border.
// the dd structure shapes are triangle, diamond and square; these two are the
// pair that cannot be mistaken for each other at icon size, where a square is
// a diamond someone turned 45°.
export const MARK = {
    candidate: `triangle-${DD.white}`,    // infrastructure near the open plume
    attributed: `diamond-${DD.white}`,    // the attributed source among them
};
export const AREA = { licence: DD.purple };
export const DASH = [2, 2];

// marking ids only expressions name, so styleimagemissing never sees them: the
// two ramps, the grey an unrated plume takes, and the white a cluster total does
export const MARKS = [...RAMP.map(c => `flare-${c}`),
                      ...[...VIRIDIS, DD.grey, DD.white].map(c => `quantitative-${c}`),
                      ...Object.values(MARK)];

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
