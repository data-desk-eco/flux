// plume source attribution: ch4id's claims, read whole from
// data-desk/attributions and drawn into the plume card's analysis slot.

import { read } from '../shell/data.js';
import { canon, escapeHtml } from '../shell/util.js';
import { selectPlume } from './candidates.js';

let epoch = 0;

// full table into a Map at boot: ~2k records, keyed by the canonical spelling
// of the plume id -- this object and the detections it joins are replaced
// separately, so the join cannot depend on the two agreeing on a namespace.
// plumes.js reads the key set the same way, to mark attributed plumes.
// a claim shows once a person confirms it at /review; the claims made before
// review began on 2026-10-04 are `grandfathered` and show as they are.
export const shown = r => ['confirmed', 'grandfathered'].includes(r.verified);
let attribs = null;
export function loadAttributions() {
    return attribs ??= (async () => {
        try {
            return new Map((await read('attributions', { columns: [
                'id', 'source_label', 'attributed_ids', 'lat', 'lon', 'confidence',
                'paragraph', 'evidence', 'verified', 'run_at'] }))
                .filter(shown).map(r => [canon(r.id), r]));
        } catch (err) {
            console.warn('attributions unavailable:', err);
            return new Map();
        }
    })();
}

// ── attribution rendering ──

// attributed source labels link out: osm ids (short w/n/r or long form) to
// osm.org, anything else flies to the feature (candidates.js delegation)
function labelHtml(rec) {
    const safe = escapeHtml(rec.source_label || '');
    const id = rec.attributed_ids?.[0];
    if (!id) return safe;
    const idSafe = escapeHtml(rec.attributed_ids.join(' '));
    const osm = id.match(/^OSM:(?:(w|n|r)|(way|node|relation)\/)(\d+)$/);
    if (osm) {
        const type = osm[2] || { w: 'way', n: 'node', r: 'relation' }[osm[1]];
        return `<a href="https://www.openstreetmap.org/${type}/${osm[3]}" target="_blank" rel="noopener" title="${idSafe}">${safe}</a>`;
    }
    return `<a href="#" data-fly="${escapeHtml(id)}" title="${idSafe}">${safe}</a>`;
}

function recordHtml(rec) {
    const evidence = rec.evidence?.length
        ? `<div class="plume-evidence">${rec.evidence.map((u, i) =>
            `<a href="${escapeHtml(u)}" target="_blank" rel="noopener" title="${escapeHtml(u)}">[${i + 1}]</a>`).join(' ')}</div>`
        : '';
    return `
        <div class="plume-attrib">${labelHtml(rec)}
            ${rec.confidence ? `<span class="dd-secondary">(confidence: ${escapeHtml(rec.confidence)})</span>` : ''}</div>
        ${rec.paragraph ? `<p class="plume-para">${escapeHtml(rec.paragraph)}</p>` : ''}
        ${evidence}`;
}

// ── detail-panel enrich hook ──

export function enrich(p) {
    const e = ++epoch;
    const lat = Number(p.lat), lon = Number(p.lon);
    (async () => {
        const rec = (await loadAttributions()).get(canon(p.id)) || null;
        if (epoch !== e) return;
        const el = document.getElementById('analysis');
        if (el) {
            el.innerHTML = rec ? recordHtml(rec) : 'No source attribution yet.';
            el.classList.toggle('dd-secondary', !rec);
        }
        // candidate sources around the plume; coarse sensors get a wider radius
        const radiusKm = /tropomi|viirs|goes|s3/i.test(p.satellite || '') ? 10 : 3;
        selectPlume(lon, lat, radiusKm, rec);
    })();
}
