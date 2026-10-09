// the data table drawer: a handle on the right edge drags open a tabbed table
// of rows, filtered to the viewport, searchable, sortable and capped. a row
// click flies to it and opens its card.
//
// config.table: [{
//   label,                        tab text
//   rows: ctx => rows | Promise,  a promise is a read, held; a plain return
//                                 is a projection of moving state, re-run
//   cols: [names],                default: the keys of row 0
//   filter: false,                opt out of the key's filters, for rows
//                                 that are not feature properties
// }]

import { escapeHtml } from './util.js';
import { viewportBbox } from './map.js';
import { showDetail } from './detail.js';

const MIN = 300, CAP = 500;
const fmt = v => typeof v === 'number' && !Number.isInteger(v)
    ? +v.toFixed(3) : v;
const inView = ([w, s, e, n]) => r => r.lat == null
    || (r.lat >= s && r.lat <= n && r.lon >= w && r.lon <= e);
// nulls last, whichever way the sort runs
const by = (col, dir) => ({ [col]: x }, { [col]: y }) =>
    x == null ? 1 : y == null ? -1 : (x < y ? -1 : x > y ? 1 : 0) * dir;

export function initTable(ctx) {
    const tabs = ctx.config.table, cache = [];
    let width = 0, active = 0, sortCol = null, sortDir = 1, q = '';
    let selected = null, shown = [];

    const tabHtml = (t, i) =>
        `<button value="${i}">${escapeHtml(t.label)}</button>`;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="fx-drawer">
            <div class="fx-drawer-head">
                <dd-toggle value="0">${tabs.map(tabHtml).join('')}</dd-toggle>
                <input type="search" class="fx-search fx-drawer-q"
                    placeholder="Search" spellcheck="false">
            </div>
            <div class="fx-drawer-wrap">
                <table class="fx-table"></table></div>
            <div class="fx-drawer-foot fx-secondary"></div>
        </div>
        <div class="fx-drawer-handle"><span>Data table</span></div>`);
    const [drawer, handle] =
        document.querySelectorAll('.fx-drawer, .fx-drawer-handle');
    const el = sel => drawer.querySelector(sel);

    // only the drag sets the width, never the rows. the map keeps its width
    // and is padded; the detail panel slides over
    const setWidth = w => {
        width = w;
        drawer.style.width = w + 'px';
        drawer.style.borderLeftWidth = w ? '1px' : '0';
        handle.style.right = w + 'px';
        ctx.map.setPadding({ right: w });
        document.getElementById('detail')
            ?.style.setProperty('right', w ? w + 'px' : '');
        // search only once there is room beside the tabs. visibility, not
        // display, so the head never changes height
        el('.fx-drawer-q').style.visibility =
            w < el('dd-toggle').offsetWidth + 200 ? 'hidden' : '';
    };

    async function render() {
        if (width < MIN) return;
        const t = tabs[active];
        const src = cache[active] ?? t.rows(ctx);
        if (src instanceof Promise) cache[active] = src;
        let all = await src;
        if (t.filter !== false && ctx.preds?.length)
            all = all.filter(r => ctx.preds.every(p => p(r)));
        const cols = t.cols || Object.keys(all[0] || {});
        const hits = all.filter(inView(viewportBbox(ctx.map))).filter(r => !q
            || cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)));
        if (sortCol) hits.sort(by(sortCol, sortDir));
        const rows = shown = hits.slice(0, CAP);
        const th = c => `<th data-col="${escapeHtml(c)}">${escapeHtml(c)}`
            + `${sortCol === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
        const tr = (r, i) => `<tr data-i="${i}"`
            + `${r === selected ? ' class="selected"' : ''}>` + cols.map(c =>
                `<td>${r[c] == null ? '' : escapeHtml(fmt(r[c]))}</td>`)
                .join('') + '</tr>';
        el('.fx-table').innerHTML = rows.length
            ? `<thead><tr>${cols.map(th).join('')}</tr></thead>`
                + `<tbody>${rows.map(tr).join('')}</tbody>`
            : '<tbody><tr><td class="fx-drawer-empty fx-secondary">'
                + 'No rows in view</td></tr></tbody>';
        el('.fx-drawer-foot').textContent = (hits.length > rows.length
            ? `${rows.length.toLocaleString()} of ` : '')
            + `${hits.length.toLocaleString()} in view`;
    }

    // open the source feature carrying the row's id
    const pick = r => {
        const idp = ctx.config.detail?.idProp || 'id';
        const f = Object.values(ctx.sources).flatMap(s => s.features)
            .find(f => f.properties[idp] === r[idp]);
        if (f) showDetail(f);
    };

    el('dd-toggle').addEventListener('change', e => {
        active = +e.target.value;
        sortCol = selected = null;
        render();
    });
    drawer.addEventListener('click', e => {
        const th = e.target.closest('th[data-col]');
        const tr = e.target.closest('tr[data-i]');
        if (th) {
            sortDir = sortCol === th.dataset.col ? -sortDir : 1;
            sortCol = th.dataset.col;
        } else if (tr) {
            const r = selected = shown[+tr.dataset.i];
            const lat = Number(r.lat), lon = Number(r.lon);
            if (isFinite(lat) && isFinite(lon)) ctx.map.flyTo({
                center: [lon, lat],
                zoom: Math.max(ctx.map.getZoom(),
                    ctx.config.detail?.flyZoom ?? 15) });
            pick(r);
        } else return;
        render();
    });

    el('.fx-drawer-q').addEventListener('input', e => {
        q = e.target.value.trim().toLowerCase();
        render();
    });
    ctx.map.on('moveend', render);
    addEventListener('fx-filters', render);

    handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        // a synthetic event has no active pointer to capture
        try { handle.setPointerCapture(e.pointerId); } catch {}
        const sx = e.clientX, sw = width;
        const move = ev => {
            const was = width;
            setWidth(Math.max(0,
                Math.min(innerWidth - 340, sw + sx - ev.clientX)));
            if (width >= MIN && was < MIN) render();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', () => {
            handle.removeEventListener('pointermove', move);
            if (width < MIN) setWidth(0); else render();
        }, { once: true });
    });
}
