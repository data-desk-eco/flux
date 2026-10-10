// the osm outline of each large facility a catalogue point falls on
// (data-desk/sites), drawn as an area: a thin solid border and an inset dash
// (pdf:67-68). it claims nothing about any detection; the reader sees what a
// flare or plume sits inside. read whole, once, off the prefetch
// (config.js): it is under the cap.

import { lines } from './vendor/dd/dd.js';
import { objects } from './shell/archive.js';
import { read } from './shell/data.js';

const KIND = { lng_terminal: 'LNG terminal', refinery: 'Refinery',
    processing_plant: 'Gas processing plant',
    chemical_plant: 'Chemical plant', terminal: 'Oil terminal' };
// below this a refinery is a few pixels and the outlines are noise
const MIN_ZOOM = 10;

// an invisible fill under the lines, so the label answers anywhere inside
export const SITE_LAYERS = [
    { id: 'sites-hit', type: 'fill', source: 'sites', minzoom: MIN_ZOOM,
      paint: { 'fill-color': '#000', 'fill-opacity': 0 },
      hover: ({ name, kind, operator: op }) => ({
          heading: name || KIND[kind],
          text: [KIND[kind], op !== name && op].filter(Boolean).join(' · '),
      }) },
    ...[['sites', lines.area()], ['sites-inset', lines.areaInset()]]
        .map(([id, l]) => ({ id, source: 'sites', minzoom: MIN_ZOOM, ...l })),
];

// the inset dash sits right of the stroke's direction, so inside a
// clockwise ring: each outer ring is wound clockwise, each hole the other way
const cw = r => r.reduce((a, [x, y], i) => {
    const [px, py] = r.at(i - 1);
    return a + (x - px) * (y + py);
}, 0) > 0 ? r : [...r].reverse();
const wind = rings => rings.map((r, i) => i ? cw(r).reverse() : cw(r));
const orient = g => ({ ...g, coordinates: g.type === 'Polygon'
    ? wind(g.coordinates) : g.coordinates.map(wind) });

export async function loadSites(map) {
    const rows = await Promise.all((await objects('sites')).map(u =>
        read(u, { columns: ['id', 'kind', 'name', 'operator', 'outline'] })));
    map.getSource('sites')?.setData({ type: 'FeatureCollection',
        features: rows.flat().map(({ outline, ...properties }) => ({
            type: 'Feature', properties,
            geometry: orient(JSON.parse(outline)) })) });
}
