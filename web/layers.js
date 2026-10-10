// marking, ramp and colour policy for every layer, in one home so no layer
// quietly spends colour on something else. shape categorises — whether a
// feature burned or leaked — and colour is measurement alone, never provider
// or category (pdf:71, 75, 76).
//
// two ramps, because they answer different questions. flaring reads on the
// dd intensity ramp, red -> orange -> white, each instrument on its own stops:
// b12 reflectance and radiant heat are different numbers for one question.
// methane reads on viridis, the ramp its plume rasters are rendered in; one
// shared ramp made a bright plume and a bright flare look like one quantity.

import { palette } from './vendor/dd/dd.js';

export const DD = palette;
export const RAMP = [DD.red, DD.orange, DD.white];   // low → high intensity

// `mark` stepped through `colors` at `breaks`, one more colour than break
const stepIcon = (mark, value, breaks, colors) =>
    ['step', value, `${mark}-${colors[0]}`,
     ...breaks.flatMap((b, i) => [b, `${mark}-${colors[i + 1]}`])];

// a site the producer gives no value for coalesces to the foot of the ramp,
// which flattens the colour rather than hiding the site
export const flareIcon = cfg => {
    const v = ['coalesce', ['get', cfg.prop], cfg.stops[0]];
    const at = s => cfg.log ? Math.log(s + 1) : s;
    return stepIcon('flare', cfg.log ? ['ln', ['+', v, 1]] : v,
        cfg.stops.slice(1).map(at), RAMP);
};

// the key's flaring bands, off the stops the step breaks at, so a row selects
// exactly the features drawn in its colour. the bottom band is a negation for
// the reason flareIcon coalesces
export const flareBands = cfg => {
    const [, mid, hi] = cfg.stops, v = p => p[cfg.prop];
    return [
        [`${hi}+`, RAMP[2], p => v(p) >= hi],
        [`${mid}`, RAMP[1], p => v(p) >= mid && v(p) < hi],
        [`<${mid}`, RAMP[0], p => !(v(p) >= mid)],
    ];
};

const VIRIDIS = ['#3B528B', '#21918C', '#5EC962', '#FDE725'];   // low → high
const PLUME_STOPS = [1000, 5000, 10000];   // kg/h, the key's bands too

// no rate is not a low rate: an unquantified plume is drawn grey, off the
// ramp and out of every band
export const plumeIcon = ['case',
    ['!=', ['typeof', ['get', 'rate_kg_h']], 'number'],
    `quantitative-${DD.grey}`,
    stepIcon('quantitative', ['get', 'rate_kg_h'], PLUME_STOPS, VIRIDIS)];

// [label in t/hr, lo kg/h, hi kg/h, colour], off the same stops
const [LO, MID, HI] = PLUME_STOPS, t = kg => kg / 1000;
export const PLUME_BANDS = [
    [`${t(HI)}+`, HI, null, VIRIDIS[3]],
    [`${t(MID)}–${t(HI)}`, MID, HI, VIRIDIS[2]],
    [`${t(LO)}–${t(MID)}`, LO, MID, VIRIDIS[1]],
    [`< ${t(LO)}`, 0, LO, VIRIDIS[0]],
];

// white is the default state. the two structure shapes that cannot be told
// apart wrongly at icon size
export const MARK = {
    candidate: `triangle-${DD.white}`,    // infrastructure near the plume
    attributed: `diamond-${DD.white}`,    // the attributed source among them
};

// where flux departs from the guidelines on purpose, written down so
// vendor/dd/audit.js passes everything else (`make audit`): viridis, the
// plume rasters' own ramp; gl text for cluster counts, which wants
// inter glyphs the basemap does not serve; the heat halo and the probability
// surface, which are data, not imagery
export const AUDIT = {
    colors: VIRIDIS,
    glyphs: ['plumes-clusters'],
    graded: ['detection-footprint', 'dd-plume-probability',
        'plume-mask-image'],
};

// marking ids only expressions name, which styleimagemissing never sees
export const MARKS = [...RAMP.map(c => `flare-${c}`),
    ...[...VIRIDIS, DD.grey, DD.white].map(c => `quantitative-${c}`),
    ...Object.values(MARK)];

// every marking pins its icon: a detection sits where it was measured, so
// overlap never moves or drops one
export const PIN = {
    'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 10, 0.8, 14, 1],
    'icon-allow-overlap': true, 'icon-ignore-placement': true,
};
// a label up-and-right at 11px (pdf:77). gl text needs sdf glyphs and the
// basemap serves no inter, so this is the nearest grotesque it does
export const RATE_LABEL = {
    'text-font': ['Montserrat Regular'], 'text-size': 11,
    'text-anchor': 'bottom-left', 'text-offset': [0.7, -0.7],
};
