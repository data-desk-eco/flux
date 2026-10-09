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

const row = (k, v, title = '') => `<dd-row class="plume-row" title="${
    title}"><span>${k}</span><span>${v}</span></dd-row>`;

// the rate, or nature trace's ppm·m enhancement where no rate was published
function rate(p) {
    const t = rateT(p), e = enhT(p);
    if (t) return row('Rate', `${t}${p.rate_std_kg_h
        ? ` ±${(p.rate_std_kg_h / 1000).toFixed(1)}` : ''} t/hr`);
    return row(e ? 'Enhancement' : 'Rate', e ? `~${e} ppm·m` : '—');
}

// the producer's wind at the plume. the arrow points the way it blows, which
// is the way the plume drifts; a speed with no direction gets no arrow
function wind({ wind_ms: ms, wind_from_deg: from }) {
    if (ms == null) return row('Wind', '—');
    const arrow = from == null ? '' : `<svg class="plume-wind"
        viewBox="0 0 24 24" style="transform: rotate(${(from + 180) % 360}deg)">
        <path d="M12 4v16M12 4 7 9M12 4l5 5"/></svg>`;
    const title = from == null ? '' : ` from ${compass(from)} (${from}°)`;
    return row('Wind', `${arrow}${ms.toFixed(1)} m/s`,
        `${ms.toFixed(1)} m/s${title}`);
}

// the producer's own record, where the heading would once have linked
const provider = p => {
    const url = sourceUrl(p), name = escapeHtml(label(p.provider));
    return url ? `<a href="${escapeHtml(url)}" target="_blank"
        rel="noopener">${name}</a>` : name;
};

export default {
    source: 'plumes',
    init: deps => { archive = deps.archive; },
    title: p => ({ text: p.id || '—' }),
    stats: p => `
            ${row('Source', provider(p))}
            ${p.sector ? row('Sector', escapeHtml(SECTOR[p.sector]
                || p.sector)) : ''}
            ${p.confidence ? row('Confidence', escapeHtml(p.confidence)) : ''}
            ${rate(p)}
            ${wind(p)}
            ${row('Satellite', escapeHtml(p.satellite || '—'))}
            ${row('Date', p.date ? escapeHtml(formatDate(p.date)) : '—')}`,
    html: () => `
        <div class="plume-analysis">
            <div>Analysis</div>
            <div id="analysis" class="fx-secondary">Loading…</div>
        </div>`,
    show: p => {
        enrich(p);
        showProbabilityOverlay(p, overlayUrl(p));
        showMask(p);
    },
    close: () => { clearSelection(); clearProbabilityOverlay(); clearMask(); },
};
