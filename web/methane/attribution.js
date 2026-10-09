// plume source attribution: ch4id's claims, read whole from
// data-desk/attributions and drawn into the plume card's analysis slot.

import { read } from '../shell/data.js';
import { canon, escapeHtml } from '../shell/util.js';
import { selectPlume } from './candidates.js';

// a claim shows once a person confirms it at /review; those made before
// review began on 2026-10-04 are grandfathered
export const shown = r => ['confirmed', 'grandfathered'].includes(r.verified);

// ~2k records, keyed by the canonical id: this object and the detections it
// joins are replaced separately, so the join cannot rely on one namespace
let attribs = null;
export const loadAttributions = () => attribs ??= read('attributions', {
    columns: ['id', 'source_label', 'attributed_ids', 'lat', 'lon',
              'confidence', 'paragraph', 'evidence', 'verified', 'run_at'],
}).then(rows => new Map(rows.filter(shown).map(r => [canon(r.id), r])))
  .catch(err => (console.warn('attributions unavailable:', err), new Map()));

const OSM = { w: 'way', n: 'node', r: 'relation' };
const out = (href, title, text) => `<a href="${escapeHtml(href)}"`
    + ` target="_blank" rel="noopener" title="${escapeHtml(title)}">`
    + `${text}</a>`;

// an osm id links to osm.org; anything else flies to the candidate
// (candidates.js handles data-fly)
function labelHtml(rec) {
    const safe = escapeHtml(rec.source_label || '');
    const id = rec.attributed_ids?.[0];
    if (!id) return safe;
    const ids = rec.attributed_ids.join(' ');
    const osm = id.match(/^OSM:(?:(w|n|r)|(way|node|relation)\/)(\d+)$/);
    if (osm) return out(`https://www.openstreetmap.org/${osm[2]
        || OSM[osm[1]]}/${osm[3]}`, ids, safe);
    return `<a href="#" data-fly="${escapeHtml(id)}"`
        + ` title="${escapeHtml(ids)}">${safe}</a>`;
}

function recordHtml(rec) {
    const evidence = rec.evidence?.length ? `<div class="plume-evidence">${
        rec.evidence.map((u, i) => out(u, u, `[${i + 1}]`)).join(' ')}</div>`
        : '';
    const confidence = rec.confidence ? `<span class="fx-secondary">`
        + `(confidence: ${escapeHtml(rec.confidence)})</span>` : '';
    const para = rec.paragraph
        ? `<p class="plume-para">${escapeHtml(rec.paragraph)}</p>` : '';
    return `<div class="plume-attrib">${labelHtml(rec)} ${confidence}</div>
        ${para}${evidence}`;
}

// the card's enrich hook, behind an epoch so a card left before its read
// lands is not written to. coarse sensors get a wider candidate radius
let epoch = 0;
export async function enrich(p) {
    const now = ++epoch;
    const rec = (await loadAttributions()).get(canon(p.id)) || null;
    if (now !== epoch) return;
    const el = document.getElementById('analysis');
    if (el) {
        el.innerHTML = rec ? recordHtml(rec) : 'No source attribution yet.';
        el.classList.toggle('fx-secondary', !rec);
    }
    const coarse = /tropomi|viirs|goes|s3/i.test(p.satellite || '');
    selectPlume(Number(p.lon), Number(p.lat), coarse ? 10 : 3, rec);
}
