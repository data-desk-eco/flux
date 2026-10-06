// the methane plume body. `show` fires enrich() (the attribution and the
// candidate sources around the plume), the probability overlay and the
// plume's mask; closing takes them all down.

import { escapeHtml, formatDate, compass } from '../shell/util.js';
import { enrich } from '../methane/attribution.js';
import { clearSelection } from '../methane/candidates.js';
import { clearProbabilityOverlay, showProbabilityOverlay }
    from '../methane/overlay.js';
import { label, rateT, enhT } from '../methane/plumes.js';
import { clearMask, showMask } from '../methane/mask.js';

let archive = '';

const SECTOR = { og: 'Oil & Gas', coal: 'Coal', waste: 'Waste',
                 other: 'Other' };

// a path on the archive, or a url as it stands
const onArchive = path => /^https?:/.test(path) ? path
    : `${archive}/${path.replace(/^\//, '')}?v=viridis`;
const enc = encodeURIComponent;

// the provider's own record of this plume, linked from the card's title
function sourceUrl({ id, provider, link }) {
    if (!id) return null;
    if (provider === 'carbon-mapper')
        return 'https://data.carbonmapper.org/?plume_id='
            + enc(id.replace(/^CM:/, ''));
    if (!link) return null;
    if (provider === 'sron')
        return `https://ftp.sron.nl/pub/memo/CSVs/${enc(link)}`;
    return provider === 'data-desk' ? onArchive(link) : null;
}

const overlayUrl = p => p.provider === 'data-desk' && p.overlay
    ? onArchive(p.overlay) : null;

// a big number over its caption
const stat = (big, caption, title = '') => `<div title="${title}">`
    + `<div class="plume-stat-big">${big}</div>`
    + `<div class="dd-secondary">${caption}</div></div>`;

// the rate, or nature trace's ppm·m enhancement where no rate was published
function rate(p) {
    const t = rateT(p), e = enhT(p);
    if (t) return stat(t, `t/hr${p.rate_std_kg_h
        ? ` ±${(p.rate_std_kg_h / 1000).toFixed(1)}` : ''}`);
    return e ? stat(`~${e}`, 'ppm·m enhancement') : stat('—', '—');
}

// the producer's wind at the plume. the arrow points the way it blows, which
// is the way the plume drifts; a speed with no direction gets no arrow
function wind({ wind_ms: ms, wind_from_deg: from }) {
    if (ms == null) return stat('—', 'wind m/s');
    const arrow = from == null ? '' : `<svg class="plume-wind"
        viewBox="0 0 24 24" style="transform: rotate(${(from + 180) % 360}deg)">
        <path d="M12 4v16M12 4 7 9M12 4l5 5"/></svg>`;
    const title = from == null ? '' : ` from ${compass(from)} (${from}°)`;
    return stat(`${arrow} ${ms.toFixed(1)}`, 'wind m/s',
        `${ms.toFixed(1)} m/s${title}`);
}

const badge = text => `<span class="dd-secondary">${escapeHtml(text)}</span>`;

export default {
    source: 'plumes',
    init: deps => { archive = deps.archive; },
    title: p => ({ text: p.id || '—', href: sourceUrl(p) }),
    html: p => `
        <div class="plume-badges">
            <span>${escapeHtml(label(p.provider))}</span>
            ${p.sector ? badge(SECTOR[p.sector] || p.sector) : ''}
            ${p.confidence ? badge(`${p.confidence} confidence`) : ''}
        </div>
        <div class="plume-stats">
            ${rate(p)}
            ${wind(p)}
            ${stat(escapeHtml(p.satellite || '—'), 'satellite')}
            ${stat(p.date ? escapeHtml(formatDate(p.date)) : '—', 'date')}
        </div>
        <div class="plume-analysis">
            <div class="dd-secondary">Analysis</div>
            <div id="analysis" class="dd-secondary">Loading…</div>
        </div>`,
    show: p => {
        enrich(p);
        showProbabilityOverlay(p, overlayUrl(p));
        showMask(p);
    },
    close: () => { clearSelection(); clearProbabilityOverlay(); clearMask(); },
};
