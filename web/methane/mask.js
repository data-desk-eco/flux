// the open plume's outline, from its provider's `masks` table, one row per
// card. where the row names an `image` (carbon mapper's png, in its own
// concentration colours) it is draped at its `corners` under the outline in
// place of the fill. no table, or no row, draws nothing.

import { read } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { DD } from '../layers.js';

const ID = 'plume-mask';   // the source, and the stem of its two layers
let map, archive, under, epoch = 0;

// `below` is the layer the mask sits under: the plumes on the main map
export const initMask = (m, a, below = 'plumes') => {
    map = m; archive = a.replace(/\/+$/, ''); under = below;
};

export function clearMask() {
    epoch++;
    for (const l of [`${ID}-image`, `${ID}-fill`, `${ID}-line`])
        if (map?.getLayer(l)) map.removeLayer(l);
    for (const s of [ID, `${ID}-image`])
        if (map?.getSource(s)) map.removeSource(s);
}

// id alone would scan every row group; the position is what prunes them, and
// it is the same rounded pair the detection carries
export async function showMask(p) {
    clearMask();
    const now = epoch;
    try {
        const objs = await objects('masks');
        if (!map || !objs.length || !p.id) return;
        const where = { id: [p.id, p.id], lat: [+p.lat, +p.lat],
                        lon: [+p.lon, +p.lon] };
        // one read per provider, so one missing object costs only its own masks
        const [row] = (await Promise.allSettled(objs.map(o =>
            read(o, { where })))).flatMap(r => r.value ?? []);
        if (!row || now !== epoch) return;
        map.addSource(ID, { type: 'geojson', data: JSON.parse(row.mask) });
        const below = map.getLayer(under) ? under : undefined;
        if (row.image && row.corners) {
            map.addSource(`${ID}-image`, { type: 'image',
                url: `${archive}/${row.image}`,
                coordinates: JSON.parse(row.corners) });
            map.addLayer({ id: `${ID}-image`, type: 'raster',
                source: `${ID}-image`, paint: { 'raster-fade-duration': 0,
                    'raster-resampling': 'nearest' } }, below);
        } else map.addLayer({ id: `${ID}-fill`, type: 'fill', source: ID,
            paint: { 'fill-color': DD.white, 'fill-opacity': 0.2 } }, below);
        map.addLayer({ id: `${ID}-line`, type: 'line', source: ID,
            paint: { 'line-color': DD.white, 'line-width': 1,
                     'line-opacity': 0.8 } }, below);
    } catch (error) {
        console.warn('plume mask unavailable:', error);
    }
}
