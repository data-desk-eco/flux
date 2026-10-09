// the dom from config, on the dd elements: the main panel (title, worldmap,
// search, quarters, sliders), the key, the detail panel, the intro and the
// logo. the elements own the chrome; this places them and fills them.

import '../vendor/dd/dd.js';
import { escapeHtml } from './util.js';

const sliderHtml = s => `<dd-slider data-key="${s.key}" label="${
    escapeHtml(s.label)}" min="${s.min}" max="${s.max}" step="${s.step}"
    value="${s.value}"></dd-slider>`;

export const logo = '<dd-logo class="fx-logo" '
    + 'href="https://research.datadesk.eco/"></dd-logo>';

const SEARCH = `<input type="search" class="fx-search" id="search"
    placeholder="Address or lat, lon" spellcheck="false" autocomplete="off">`;
const QUARTERS = `<div><div class="fx-quarters" id="quarters"></div>
    <div class="fx-hint" id="quarters-hint"></div></div>`;

export function buildShell(config) {
    const title = escapeHtml(config.title);
    // on the panel heading too, so it outlives the intro
    const badge = config.badge ? ` <span class="fx-badge">${
        escapeHtml(config.badge)}</span>` : '';
    document.body.insertAdjacentHTML('afterbegin', `
    <div id="map"></div>

    <dd-panel class="fx-main" id="main-panel" collapsible${
        config.about ? ' info' : ''}>
        <span slot="title">${title}${badge}</span>
        <span slot="subtitle">${escapeHtml(config.subtitle || '')}</span>
        <svg id="worldmap"></svg>
        ${config.search ? SEARCH : ''}
        ${config.quarters ? QUARTERS : ''}
        ${config.sliders?.length ? `<div class="fx-sliders">${
            config.sliders.map(sliderHtml).join('')}</div>` : ''}
    </dd-panel>

    <dd-key class="fx-key" id="key-panel"></dd-key>

    <dd-panel class="fx-detail" id="detail" collapsible></dd-panel>

    ${logo}

    ${config.about ? `
    <div class="fx-modal" id="about-modal">
        <dd-panel intro class="fx-modal-content">
            <span slot="title">${title}${badge}</span>
            ${config.about}
            <dd-btn id="enter-btn">Enter</dd-btn>
        </dd-panel>
    </div>` : ''}`);
    if (config.about) wireIntro(config.title || '');
}

// enter or the overlay dismisses it, remembered per title (one origin serves
// several maps); ⓘ reopens it (pdf:82)
function wireIntro(title) {
    const modal = document.getElementById('about-modal');
    const seen = `fx-entered:${title}`;
    const dismiss = () => {
        modal.classList.add('hidden');
        localStorage.setItem(seen, '1');
    };
    modal.addEventListener('click', e => e.target === modal && dismiss());
    document.getElementById('enter-btn').addEventListener('click', dismiss);
    document.getElementById('main-panel')
        .addEventListener('info', () => modal.classList.remove('hidden'));
    if (localStorage.getItem(seen)) modal.classList.add('hidden');
}

// each slider shows its formatted value and calls onInput(value, ctx)
export function wireSliders(config, ctx) {
    for (const s of config.sliders || []) {
        const el = document.querySelector(`dd-slider[data-key="${s.key}"]`);
        el.format = s.format || String;
        el.render();
        el.addEventListener('input', () => s.onInput?.(el.value, ctx));
    }
}

// ── the key ──

// sections: [{label, rows: [{swatch: {mark, color}, label, toggle: id |
// [ids], pred}]}]. a `toggle` row switches layers; `pred` rows are a
// multi-select per section, active rows ORed into the filter (all on is no
// filter). the key element collapses itself; set() re-renders.
//
// a section's rows partition one family, and a row is no statement about a
// feature outside it — so a feature every row admits is outside the section,
// and survives the whole section going off. that is how one key filters a map
// of several sources.
export function initKey(map, onFilter) {
    let sections = [];
    const el = document.getElementById('key-panel');
    const visible = id => map.getLayoutProperty(id, 'visibility') !== 'none';
    const rowHtml = (r, si, ri) => {
        const ids = [].concat(r.toggle || []), s = r.swatch || {};
        const on = r.pred ? !r.off : !ids.length || visible(ids[0]);
        return `<dd-key-row mark="${s.mark || ''}" color="${s.color || ''}"${
            on ? '' : ' inactive'}${ids.length || r.pred ? ' class="fx-toggle"'
            : ''}${ids.length ? ` data-layers="${ids.join(' ')}"` : ''}${
            r.pred ? ` data-row="${si}.${ri}"` : ''}>${
            escapeHtml(r.label)}</dd-key-row>`;
    };
    const render = () => {
        el.innerHTML = sections.map((s, si) => `<dd-key-group label="${
            escapeHtml(s.label)}">${s.rows.map((r, ri) => rowHtml(r, si, ri))
            .join('')}</dd-key-group>`).join('');
    };

    el.addEventListener('click', e => {
        const t = e.target.closest('.fx-toggle');
        if (t?.dataset.row) {
            const [si, ri] = t.dataset.row.split('.').map(Number);
            const r = sections[si].rows[ri];
            r.off = !r.off;
            onFilter?.();
        } else if (t) {
            const ids = t.dataset.layers.split(' ');
            const to = visible(ids[0]) ? 'none' : 'visible';
            for (const id of ids) map.setLayoutProperty(id, 'visibility', to);
        } else return;
        render();
    });

    // groups side by side where the stack would not clear the main panel
    // (ruling 2026-07-08): four stacked are 465px tall
    const wide = matchMedia('(max-height: 1040px) and (min-width: 769px)');
    const flow = () => el.toggleAttribute('row', wide.matches);
    wide.addEventListener('change', flow);
    flow();

    return {
        set: s => { sections = s; render(); },
        preds: () => sections.flatMap(s => {
            const rows = s.rows.filter(r => r.pred);
            return rows.some(r => r.off) ? [p => rows.some(r =>
                !r.off && r.pred(p)) || rows.every(r => r.pred(p))] : [];
        }),
    };
}
