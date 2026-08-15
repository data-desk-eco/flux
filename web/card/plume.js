// the methane plume body. its html is a sync skeleton: `show` fires enrich(),
// which races the open-meteo wind fetch and the attribution lookup into
// #stat-wind and #analysis behind a request-id guard, then draws the candidate
// sources around the plume. closing takes both down.

import { escapeHtml } from '../vendor/cartograph/util.js';
import { enrich } from '../methane/attribution.js';
import { clearSelection } from '../methane/candidates.js';
import { clearProbabilityOverlay, showProbabilityOverlay } from '../methane/overlay.js';

let archive = '';

// a label is editorial, so it is stated here. which providers exist is not: a
// provider the archive adds lands on the map under its own name. provider is no
// longer a colour — colour means intensity everywhere on this map (layers.js).
const LABEL = { 'carbon-mapper': 'Carbon Mapper', imeo: 'IMEO / MARS', sron: 'SRON', ghgsat: 'GHGSat', 'data-desk': 'Data Desk' };
export const label = p => LABEL[p] ?? p;
const SECTOR = { og: 'Oil & Gas', coal: 'Coal', waste: 'Waste', other: 'Other' };

// null when the provider published no rate estimate
export const rateT = p => p.rate_kg_h == null ? null : (Number(p.rate_kg_h) / 1000).toFixed(1);

// the provider's own record of this plume, linked from the card's title
function sourceUrl(p) {
    if (!p.id) return null;
    if (p.provider === 'carbon-mapper') return `https://data.carbonmapper.org/?plume_id=${encodeURIComponent(p.id)}`;
    if (p.provider === 'sron' && p.link) return `https://ftp.sron.nl/pub/memo/CSVs/${encodeURIComponent(p.link)}`;
    if (p.provider === 'data-desk' && p.link)
        return /^https?:/.test(p.link) ? p.link : `${archive}/${p.link.replace(/^\//, '')}?v=viridis`;
    return null;
}

function overlayUrl(p) {
    if (p.provider !== 'data-desk' || !p.overlay) return null;
    return /^https?:/.test(p.overlay) ? p.overlay : `${archive}/${p.overlay.replace(/^\//, '')}?v=viridis`;
}

export default {
    kind: 'plume',
    source: 'plumes',
    init: deps => { archive = deps.archive; },
    title: p => ({ text: p.id || '—', href: sourceUrl(p) }),
    html: p => `
        <div class="fd-badges">
            <span>${escapeHtml(label(p.provider))}</span>
            ${p.sector ? `<span class="dd-secondary">${SECTOR[p.sector] || escapeHtml(p.sector)}</span>` : ''}
        </div>
        <div class="fd-stats">
            <div><div class="fd-stat-big">${rateT(p) ?? '—'}</div><div class="dd-secondary">t/hr${p.rate_std_kg_h ? ` ±${(p.rate_std_kg_h / 1000).toFixed(1)}` : ''}</div></div>
            <div id="stat-wind"><div class="fd-stat-big">…</div><div class="dd-secondary">wind</div></div>
            <div><div class="fd-stat-big">${escapeHtml(p.satellite || '—')}</div><div class="dd-secondary">satellite</div></div>
            <div><div class="fd-stat-big">${escapeHtml(p.date || '—')}</div><div class="dd-secondary">date</div></div>
        </div>
        <div class="fd-analysis">
            <div class="dd-secondary">Analysis</div>
            <div id="analysis" class="dd-secondary">Loading…</div>
        </div>`,
    show: p => { enrich(p); showProbabilityOverlay(p, overlayUrl(p)); },
    close: () => { clearSelection(); clearProbabilityOverlay(); },
};
