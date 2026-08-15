// plume source attribution — served entirely from the bulk agent-produced
// dataset (attributions/data.parquet on the store, pushed by the sibling ch4id
// repo), read in-browser via DuckDB. wind is fetched per plume from
// open-meteo as an independent panel stat.

import { read } from './vendor/cartograph/data.js';
import { escapeHtml, compass } from './vendor/cartograph/util.js';
import { selectPlume } from './candidates.js';

let requestId = 0;

// full table into a Map at boot: ~2k records, keyed by plume display id.
// config.js also reads the key set to mark attributed plumes.
let attribs = null;
export function loadAttributions() {
    return attribs ??= (async () => {
        try {
            return new Map((await read('attributions', { columns: [
                'id', 'source_label', 'attributed_ids', 'lat', 'lon', 'confidence',
                'paragraph', 'evidence'] })).map(r => [r.id, r]));
        } catch (err) {
            console.warn('attributions unavailable:', err);
            return new Map();
        }
    })();
}

// ── wind (independent panel stat) ──

// daily vector-mean surface wind at the plume coordinate from open-meteo's
// historical archive (no key, cors-friendly), so brief gusts in random
// directions don't dominate. wind_direction is "FROM": convert to "TO" for
// the vector sum so opposing winds cancel rather than averaging in direction
// space (unstable around 0°/360°).
async function fetchWind(lat, lon, dateISO) {
    if (!dateISO) return null;
    try {
        const data = await (await fetch(`https://archive-api.open-meteo.com/v1/archive`
            + `?latitude=${lat}&longitude=${lon}&start_date=${dateISO}&end_date=${dateISO}`
            + `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=auto`)).json();
        const { wind_speed_10m: speeds, wind_direction_10m: dirs } = data.hourly || {};
        if (!speeds) return null;
        let u = 0, v = 0, n = 0;
        for (let i = 0; i < speeds.length; i++) {
            if (speeds[i] == null || dirs[i] == null) continue;
            const radTo = ((dirs[i] + 180) % 360) * Math.PI / 180;
            u += speeds[i] * Math.sin(radTo);
            v += speeds[i] * Math.cos(radTo);
            n++;
        }
        if (!n) return null;
        u /= n; v /= n;
        const toDeg = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
        return { speed: Math.hypot(u, v), fromDeg: (toDeg + 180) % 360, toDeg };
    } catch { return null; }
}

// svg arrow rotated to point where the wind blows TO (the plume drift direction)
function renderWind(wind) {
    const el = document.getElementById('stat-wind');
    if (!el) return;
    if (!wind) { el.querySelector('.fd-stat-big').textContent = '—'; return; }
    const speed = wind.speed.toFixed(1);
    el.title = `${speed} m/s from ${compass(wind.fromDeg)} (${Math.round(wind.fromDeg)}°)`;
    el.querySelector('.fd-stat-big').innerHTML = `
        <svg class="fd-wind" viewBox="0 0 24 24" style="transform: rotate(${wind.toDeg}deg)">
            <path d="M12 4 L12 20 M12 4 L7 9 M12 4 L17 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg> ${speed}`;
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
        ? `<div class="fd-evidence">${rec.evidence.map((u, i) =>
            `<a href="${escapeHtml(u)}" target="_blank" rel="noopener" title="${escapeHtml(u)}">[${i + 1}]</a>`).join(' ')}</div>`
        : '';
    return `
        <div class="fd-attrib">${labelHtml(rec)}
            ${rec.confidence ? `<span class="dd-secondary">(confidence: ${escapeHtml(rec.confidence)})</span>` : ''}</div>
        ${rec.paragraph ? `<p class="fd-para">${escapeHtml(rec.paragraph)}</p>` : ''}
        ${evidence}`;
}

// ── detail-panel enrich hook ──

export function enrich(p) {
    const id = ++requestId;
    const lat = Number(p.lat), lon = Number(p.lon);

    fetchWind(lat, lon, p.date).then(w => { if (requestId === id) renderWind(w); });

    (async () => {
        const rec = (await loadAttributions()).get(p.id) || null;
        if (requestId !== id) return;
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
