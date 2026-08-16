// the vnf flare body: the same furniture as the s2 one over eog/detections, on
// radiant heat. no imagery — a nightfire look is a point, not a scene — so a
// selected night draws the heat footprint and nothing else, and there is no
// image button and no csv (the series is eog's to publish, not ours).

import { MODE } from '../flaring/render.js';
import { fetchVNFDetections } from '../flaring/vnf.js';
import { current, coords, siteTitle, heatFootprint } from './index.js';

function footprint(det) {
    if (!det || !current) return;
    const [lon, lat] = coords(current);
    const val = det.rh_mw || 0;
    heatFootprint({ lon, lat, val, radiusM: 50 * Math.sqrt(Math.max(val, 0.5)), cfg: MODE.vnf });
}

export default {
    source: 'vnf',
    cfg: MODE.vnf,
    passLabel: 'Nights read',
    title: p => siteTitle(p, `Flare #${p.id}`),
    fetch: fetchVNFDetections,
    select: footprint,
};
