// the dom from config: the main panel (title, worldmap, search, quarters,
// sliders), the key, the detail skeleton, the intro modal and the logo.

import { markSVG } from '../vendor/dd/markings.js';
import { escapeHtml } from './util.js';

const LOGO_PATH = [
    'M144.68,0c-4.92,0-9.63,1.99-13.05,5.52L4.17,136.69C1.49,139.44,0,1',
    '43.12,0,146.96v440.75c-.01,3.83,1.54,7.6,4.22,10.32l128.48,130.9c2',
    '.77,2.82,6.56,4.41,10.51,4.41h224.12c49.96,0,98.27-9.63,143.61-28.',
    '63,43.81-18.36,83.08-44.69,116.71-78.24,33.61-33.53,59.98-72.67,78',
    '.37-116.33,19.01-45.12,28.64-93.17,28.64-142.81s-9.72-97.68-28.88-',
    '142.97c-18.5-43.74-44.99-83.02-78.72-116.76-33.73-33.73-73.02-60.2',
    '2-116.76-78.72C465.01,9.72,416.91,0,367.33,0H144.68ZM29.46,152.93L',
    '128.48,51.03V455.48c0,8.13,6.59,14.73,14.73,14.73h224.12c56.73,0,1',
    '02.88-46.15,102.88-102.88s-46.15-102.88-102.88-102.88h-73.42v-102.',
    '77h73.42c17.17,0,34.01,2.09,50.25,6.15,1.62,.41,3.24,.83,4.85,1.28',
    ',2.42,.67,4.82,1.38,7.2,2.13,31.02,9.82,59.45,27,83.11,50.67,26.1,',
    '26.1,44.31,57.97,53.46,92.74,1.49,5.66,2.74,11.4,3.74,17.2,.29,1.6',
    '6,.55,3.32,.8,4.99,1.48,10.01,2.23,20.19,2.23,30.49s-.75,20.48-2.2',
    '3,30.49c-.25,1.67-.51,3.33-.8,4.99-1,5.8-2.25,11.54-3.74,17.2-9.15',
    ',34.77-27.36,66.65-53.46,92.74-23.67,23.67-52.09,40.86-83.11,50.67',
    '-2.39,.76-4.79,1.47-7.2,2.13-1.61,.44-3.23,.87-4.85,1.28-16.23,4.0',
    '6-33.08,6.15-50.25,6.15H29.46V152.93Zm264.45,140.98h73.42c40.48,0,',
    '73.42,32.94,73.42,73.42s-32.94,73.42-73.42,73.42h-73.42v-146.84Zm3',
    '84.96,204.79c-16.9,40.12-41.13,76.09-72.02,106.91-30.92,30.85-67.0',
    '2,55.05-107.29,71.93-41.71,17.48-86.19,26.34-132.22,26.34H149.39l-',
    '99.57-101.44H367.33c31.73,0,62.53-6.22,91.52-18.48,28-11.84,53.14-',
    '28.79,74.73-50.38,6.75-6.75,13.04-13.84,18.86-21.26,12.82-16.32,23',
    '.37-34.22,31.51-53.47,7.66-18.12,12.97-36.95,15.87-56.26,1.74-11.5',
    '9,2.61-23.36,2.61-35.26s-.87-23.67-2.61-35.26c-2.9-19.32-8.2-38.14',
    '-15.87-56.26-8.14-19.25-18.7-37.15-31.51-53.47-5.83-7.42-12.12-14.',
    '51-18.86-21.26-21.59-21.59-46.73-38.54-74.73-50.38-28.99-12.26-59.',
    '79-18.48-91.52-18.48h-88.15c-8.13,0-14.73,6.59-14.73,14.73V440.75h',
    '-106.51V29.46h209.39c45.61,0,89.85,8.93,131.5,26.55,40.23,17.02,76',
    '.37,41.39,107.4,72.42,31.04,31.04,55.4,67.17,72.42,107.4,17.62,41.',
    '64,26.55,85.89,26.55,131.5s-8.86,89.89-26.33,131.37Z',
].join('');

const sliderGroup = s => `
    <div class="fx-slider" data-key="${s.key}">
        <div class="dd-slider-label">${escapeHtml(s.label)}</div>
        <div class="dd-slider-row"><input type="range" class="dd-slider"
            min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">
            <span class="fx-slider-val"></span></div>
    </div>`;

export const logo = `<a class="dd-logo" href="https://research.datadesk.eco/"
    target="_blank" rel="noopener"><svg viewBox="0 0 734.66 733.34">
    <path fill="currentColor" d="${LOGO_PATH}"/></svg></a>`;

const chevron = id => `<button class="dd-chevron-btn" id="${id}"
    title="Contract"><span class="dd-chevron"></span></button>`;
const SEARCH = `<input type="search" class="fx-search" id="search"
    placeholder="Address or lat, lon" spellcheck="false" autocomplete="off">`;
const QUARTERS = `<div><div class="dd-dot-grid" id="quarters"></div>
    <div class="fx-hint dd-secondary" id="quarters-hint"></div></div>`;
const INFO =
    '<button class="dd-info-btn" id="info-btn" title="About">i</button>';

export function buildShell(config) {
    const title = escapeHtml(config.title);
    // on the panel heading too, so it outlives the intro
    const badge = config.badge ? '<span class="dd-secondary fx-badge">'
        + `${escapeHtml(config.badge)}</span>` : '';
    document.body.insertAdjacentHTML('afterbegin', `
    <div id="map"></div>

    <div class="dd-panel dd-panel-l dd-gap dd-gap-l fx-main custom-scroll"
        id="main-panel">
        <div class="dd-head">
            ${chevron('main-collapse')}
            <div class="dd-head-text">
                <div class="dd-heading"><span id="main-title">${title}</span
                    >${badge}${config.about ? INFO : ''}</div>
                <div class="dd-subtitle">${escapeHtml(config.subtitle || '')}
                </div>
            </div>
        </div>
        <svg id="worldmap"></svg>
        ${config.search ? SEARCH : ''}
        ${config.quarters ? QUARTERS : ''}
        ${config.sliders?.length ? `<div class="dd-gap">${
            config.sliders.map(sliderGroup).join('')}</div>` : ''}
    </div>

    <div class="dd-panel fx-key" id="key-panel"></div>

    <div class="dd-panel dd-panel-l fx-detail custom-scroll" id="detail"></div>

    ${logo}

    ${config.about ? `
    <div class="fx-modal" id="about-modal">
        <div class="dd-panel dd-panel-l fx-modal-content custom-scroll">
            <h2 class="dd-intro-heading">${title}${badge}</h2>
            <div class="dd-intro-body">${config.about}</div>
            <button class="dd-btn fx-enter" id="enter-btn">Enter</button>
        </div>
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
    document.getElementById('info-btn')
        .addEventListener('click', () => modal.classList.remove('hidden'));
    if (localStorage.getItem(seen)) modal.classList.add('hidden');
}

// each input shows its formatted value and calls onInput(value, ctx)
export function wireSliders(config, ctx) {
    for (const s of config.sliders || []) {
        const input = document.querySelector(
            `.fx-slider[data-key="${s.key}"] input`);
        const out = input.nextElementSibling, fmt = s.format || String;
        const render = () => { out.textContent = fmt(+input.value); };
        input.addEventListener('input', () => {
            render();
            s.onInput?.(+input.value, ctx);
        });
        render();
    }
}

// ── the key ──

// a dd marking tinted by css colour, or a ring
const marks = {};
async function swatchHtml(s) {
    if (s.mark) return `<span class="fx-swatch" style="color:${s.color}">${
        marks[s.mark] ??= await markSVG(s.mark)}</span>`;
    if (s.ring) return '<span class="fx-swatch"><span class="fx-ring" style="'
        + `border-color:${s.ring};width:9px;height:9px"></span></span>`;
    return '<span class="fx-swatch"></span>';
}

// sections: [{label, rows: [{swatch, label, toggle: id | [ids], pred}]}].
// a `toggle` row switches layers; `pred` rows are a multi-select per section,
// active rows ORed into the filter (all on is no filter). one chevron
// collapses the key. set() re-renders.
//
// a section's rows partition one family, and a row is no statement about a
// feature outside it — so a feature every row admits is outside the section,
// and survives the whole section going off. that is how one key filters a map
// of several sources.
export function initKey(map, onFilter) {
    let sections = [], open = true;
    const visible = id => map.getLayoutProperty(id, 'visibility') !== 'none';
    const rowHtml = async (r, si, ri) => {
        const ids = [].concat(r.toggle || []);
        const on = r.pred ? !r.off : !ids.length || visible(ids[0]);
        return `<div class="dd-key-row${on ? '' : ' dd-inactive'}${
            ids.length || r.pred ? ' fx-toggle' : ''}"${
            ids.length ? ` data-layers="${ids.join(' ')}"` : ''}${
            r.pred ? ` data-row="${si}.${ri}"` : ''}>${
            await swatchHtml(r.swatch || {})}${escapeHtml(r.label)}</div>`;
    };
    const sectionHtml = async (s, si) => `
        <div class="fx-key-section"><div class="fx-key-head">${si ? ''
            : `<span class="dd-chevron${open ? '' : ' dd-chevron-down'}">`
            + '</span>'}<span class="dd-secondary">${escapeHtml(s.label)}</span>
        </div>${open ? `<div class="fx-key-items">${(await Promise.all(
            s.rows.map((r, ri) => rowHtml(r, si, ri)))).join('')}</div>` : ''}
        </div>`;
    const render = async () => {
        document.getElementById('key-panel').innerHTML =
            (await Promise.all(sections.map(sectionHtml))).join('');
    };

    document.getElementById('key-panel').addEventListener('click', e => {
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
        } else if (e.target.closest('.fx-key-head')) {
            open = !open;
        } else return;
        render();
    });

    return {
        set: async s => { sections = s; await render(); },
        preds: () => sections.flatMap(s => {
            const rows = s.rows.filter(r => r.pred);
            return rows.some(r => r.off) ? [p => rows.some(r =>
                !r.off && r.pred(p)) || rows.every(r => r.pred(p))] : [];
        }),
    };
}
