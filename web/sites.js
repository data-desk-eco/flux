// the osm outline of each industrial facility a flare or a plume can come
// from (data-desk/sites), drawn as an area: a thin solid border and an
// inset dash (pdf:67-68). the table holds 88,000 outlines, most of which no
// detection sits in, so it is read for the viewport and an outline is drawn
// only while a drawn detection is inside it. it claims nothing about the
// detection; the reader sees what the flare or plume sits inside.

import { lines } from './vendor/dd/dd.js';
import { objects } from './shell/archive.js';
import { read } from './shell/data.js';

const KIND = { refinery: 'Refinery', lng_terminal: 'LNG terminal',
    processing_plant: 'Gas processing plant', gas_terminal: 'Gas terminal',
    oil_terminal: 'Oil terminal', compressor_station: 'Compressor station',
    gas_storage: 'Gas storage', well_pad: 'Well pad',
    oil_gas_facility: 'Oil and gas facility',
    chemical_plant: 'Chemical plant', power_plant: 'Power plant',
    coal_mine: 'Coal mine', coal_terminal: 'Coal terminal',
    coke_plant: 'Coking plant', steel_plant: 'Steelworks',
    cement_plant: 'Cement plant', landfill: 'Landfill',
    wastewater_plant: 'Wastewater plant' };
// below this a refinery is a few pixels and the outlines are noise
export const SITE_ZOOM = 10;
// the layers whose points an outline must hold to be drawn
const HELD_BY = ['detections', 'vnf', 'plumes'];

// an invisible fill under the lines, so the label answers anywhere inside
export const SITE_LAYERS = [
    { id: 'sites-hit', type: 'fill', source: 'sites', minzoom: SITE_ZOOM,
      paint: { 'fill-color': '#000', 'fill-opacity': 0 },
      hover: ({ name, kind, operator: op }) => ({
          heading: name || KIND[kind],
          text: [KIND[kind], op !== name && op].filter(Boolean).join(' · '),
      }) },
    ...[['sites', lines.area()], ['sites-inset', lines.areaInset()]]
        .map(([id, l]) => ({ id, source: 'sites', minzoom: SITE_ZOOM,
                             ...l })),
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

// the outlines that touch the viewport: the table is hilbert-ordered, so the
// box prunes to the row groups around it. parsed once per site
const parsed = new Map();
export async function readSites([w, s, e, n]) {
    const rows = await Promise.all((await objects('sites')).map(u => read(u, {
        columns: ['id', 'kind', 'name', 'operator', 'xmin', 'ymin', 'xmax',
                  'ymax', 'outline'],
        where: { xmin: [null, e], xmax: [w, null], ymin: [null, n],
                 ymax: [s, null] } })));
    return rows.flat().map(({ outline, ...p }) => {
        if (!parsed.has(p.id)) parsed.set(p.id, { type: 'Feature',
            properties: p, geometry: orient(JSON.parse(outline)) });
        return parsed.get(p.id);
    });
}

// even-odd over every ring, so a hole holds nothing
const inRing = ([x, y], r) => r.reduce((c, [ax, ay], i) => {
    const [bx, by] = r.at(i - 1);
    return (ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax
        ? !c : c;
}, false);
const holds = ({ geometry: g, properties: b }, [x, y]) =>
    x >= b.xmin && x <= b.xmax && y >= b.ymin && y <= b.ymax
    && (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
        .some(poly => poly.reduce((c, r) => inRing([x, y], r) ? !c : c,
                                  false));

// the sites read for the viewport that hold a point the map is drawing:
// `shown(id)` is a layer's features as drawn, after the key's filters
export function drawSites(map, sites, shown) {
    const points = HELD_BY.flatMap(id => shown(id))
        .map(f => f.geometry?.coordinates).filter(Boolean);
    map.getSource('sites')?.setData({ type: 'FeatureCollection',
        features: sites.filter(s => points.some(p => holds(s, p))) });
}
