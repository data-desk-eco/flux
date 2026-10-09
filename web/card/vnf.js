// the vnf flare body: the series card over eog/detections, on radiant heat.
// a nightfire look is a point, not a scene, so a selected night draws the
// heat halo alone; no image, and no csv (the series is eog's to publish).

import { MODE } from '../flaring/render.js';
import { fetchVNFDetections } from '../flaring/vnf.js';
import { current, coords, siteTitle } from './index.js';
import { heatFootprint } from './overlays.js';

function footprint(det) {
    if (!det || !current) return;
    const [lon, lat] = coords(current);
    const val = det.rh_mw || 0;
    heatFootprint({ lon, lat, val, cfg: MODE.vnf,
                    radiusM: 50 * Math.sqrt(Math.max(val, 0.5)) });
}

export default {
    source: 'vnf',
    cfg: MODE.vnf,
    instrument: 'VNF',
    passLabel: 'Nights read',
    title: p => siteTitle(p, `Flare #${p.id}`),
    fetch: fetchVNFDetections,
    select: footprint,
};
