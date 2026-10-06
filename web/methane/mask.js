// the open plume's mask: the outline its provider drew round it, from that
// provider's `masks` table, read for the one plume when its card opens. a
// provider with no masks table, or a plume with no row, draws nothing.

import { read } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { DD } from '../layers.js';

const ID = 'plume-mask';   // the source, and the stem of its two layers
let map, epoch = 0;

export const initMask = value => { map = value; };

export function clearMask() {
    epoch++;
    for (const l of [`${ID}-fill`, `${ID}-line`]) if (map?.getLayer(l)) map.removeLayer(l);
    if (map?.getSource(ID)) map.removeSource(ID);
}

// id alone would scan every row group; the position is what prunes them, and
// it is the same rounded pair the detection carries
export async function showMask(p) {
    clearMask();
    const now = epoch;
    try {
        const objs = await objects('masks');
        if (!map || !objs.length || !p.id) return;
        const where = { id: [p.id, p.id], lat: [+p.lat, +p.lat], lon: [+p.lon, +p.lon] };
        // one read per provider, so one missing object costs only its own masks
        const [row] = (await Promise.allSettled(objs.map(o =>
            read(o, { columns: ['mask'], where })))).flatMap(r => r.value ?? []);
        if (!row || now !== epoch) return;
        map.addSource(ID, { type: 'geojson', data: JSON.parse(row.mask) });
        const below = map.getLayer('plumes') ? 'plumes' : undefined;
        map.addLayer({ id: `${ID}-fill`, type: 'fill', source: ID,
            paint: { 'fill-color': DD.white, 'fill-opacity': 0.2 } }, below);
        map.addLayer({ id: `${ID}-line`, type: 'line', source: ID,
            paint: { 'line-color': DD.white, 'line-width': 1, 'line-opacity': 0.8 } }, below);
    } catch (error) {
        console.warn('plume mask unavailable:', error);
    }
}
