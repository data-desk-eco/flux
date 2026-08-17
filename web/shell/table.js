// the data table drawer: a mid-right handle drags open a tabbed table of raw
// rows — viewport-filtered when rows carry lat/lon, substring-searched, sortable
// by column, capped with an in-view count. clicking a row flies to it and opens
// its card (or the tab's own pick hook).
//
// config.table: [{
//   label,                        tab text
//   rows: ctx => rows | Promise,  row objects; a promise is resolved once, a
//                                 sync return re-read on every render
//   cols: [names],                column subset/order (default: keys of row 0)
//   lat, lon: 'lat', 'lon',       coord columns (viewport filter + fly)
//   pick: (row, ctx) => {},       row click; default opens detail by idProp
//   filter: false,                opt out of the key's filter pipeline, which
//                                 every tab follows by default — for a tab
//                                 whose rows are not feature properties
// }]

import { escapeHtml, tableRows } from './util.js';
import { viewportBbox } from './map.js';
import { showDetail } from './detail.js';

const MIN = 300;
const fmt = v => typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(3) : v;

export function initTable(ctx) {
    const tabs = ctx.config.table, cache = [];
    let width = 0, active = 0, sortCol = null, sortDir = 1, q = '', selected = null, shown = [];

    document.body.insertAdjacentHTML('beforeend', `
        <div class="fx-drawer">
            <div class="fx-drawer-head">
                <div class="dd-toggle">${tabs.map((t, i) =>
                    `<button class="fx-opt${i ? '' : ' active'}" data-tab="${i}">${escapeHtml(t.label)}</button>`
                ).join('<span class="dd-toggle-divider"></span>')}</div>
                <input type="search" class="fx-search fx-drawer-q" placeholder="Search" spellcheck="false">
            </div>
            <div class="fx-drawer-wrap custom-scroll"><table class="fx-table"></table></div>
            <div class="fx-drawer-foot dd-secondary"></div>
        </div>
        <div class="fx-drawer-handle"><span>Data table</span></div>`);
    const [drawer, handle] = document.querySelectorAll('.fx-drawer, .fx-drawer-handle');
    const el = sel => drawer.querySelector(sel);

    // the drag is the only thing that sets the width — a re-render never
    // resizes the drawer to its rows, so a search that matches nothing leaves
    // it exactly where the user put it.
    // map keeps full width; padding shifts its logical centre, the detail
    // panel slides over
    const setWidth = w => {
        width = w;
        drawer.style.width = w + 'px';
        drawer.style.borderLeftWidth = w ? '1px' : '0';   // no 1px sliver when shut
        handle.style.right = w + 'px';
        ctx.map.setPadding({ right: w });
        document.getElementById('detail')?.style.setProperty('right', w ? w + 'px' : '');
        // search box only once there's room for it beside the tabs (which
        // keep their natural width — the css never stretches or shrinks them).
        // visibility, not display: it stays in layout so the head never
        // changes height as the drawer crosses the threshold
        el('.fx-drawer-q').style.visibility = w < el('.dd-toggle').offsetWidth + 200 ? 'hidden' : '';
    };

    async function render() {
        if (width < MIN) return;
        const t = tabs[active];
        // an async rows() is a read: fetched once. a sync one is a projection of
        // state the app keeps moving — a source it re-sets on the window — so it
        // runs every render and the table follows.
        const src = cache[active] ?? t.rows(ctx);
        if (src instanceof Promise) cache[active] = src;
        let all = await src;
        if (t.filter !== false && ctx.preds?.length) all = all.filter(r => ctx.preds.every(p => p(r)));
        const cols = t.cols || Object.keys(all[0] || {});
        const { rows, total } = tableRows(all, {
            cols, q, sortCol, sortDir, lat: t.lat, lon: t.lon, bounds: viewportBbox(ctx.map) });
        shown = rows;
        el('.fx-table').innerHTML = rows.length ? `
            <thead><tr>${cols.map(c => `<th data-col="${escapeHtml(c)}">${escapeHtml(c)}${
                sortCol === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((r, i) => `<tr data-i="${i}"${r === selected ? ' class="selected"' : ''}>${
                cols.map(c => `<td>${r[c] == null ? '' : escapeHtml(fmt(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>`
            : '<tbody><tr><td class="fx-drawer-empty dd-secondary">No rows in view</td></tr></tbody>';
        el('.fx-drawer-foot').textContent =
            (total > rows.length ? `${rows.length.toLocaleString()} of ` : '') + `${total.toLocaleString()} in view`;
    }

    // default row pick: match a source feature on the detail id and open it
    const pick = r => {
        const idp = ctx.config.detail?.idProp || 'id';
        const f = Object.values(ctx.sources).flatMap(s => s.features).find(f => f.properties[idp] === r[idp]);
        if (f) showDetail(f);
    };

    drawer.addEventListener('click', e => {
        const tab = e.target.closest('[data-tab]');
        const th = e.target.closest('th[data-col]');
        const tr = e.target.closest('tr[data-i]');
        if (tab) {
            active = +tab.dataset.tab;
            sortCol = null; selected = null;
            drawer.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === tab));
        } else if (th) {
            sortDir = sortCol === th.dataset.col ? -sortDir : 1;
            sortCol = th.dataset.col;
        } else if (tr) {
            const t = tabs[active], r = shown[+tr.dataset.i];
            selected = r;
            const lat = Number(r[t.lat || 'lat']), lon = Number(r[t.lon || 'lon']);
            if (isFinite(lat) && isFinite(lon))
                ctx.map.flyTo({ center: [lon, lat], zoom: Math.max(ctx.map.getZoom(), ctx.config.detail?.flyZoom ?? 15) });
            (t.pick || pick)(r, ctx);
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
        try { handle.setPointerCapture(e.pointerId); } catch {}   // synthetic events have no active pointer
        const sx = e.clientX, sw = width;
        const move = ev => {
            const was = width;
            setWidth(Math.max(0, Math.min(innerWidth - 340, sw + sx - ev.clientX)));
            if (width >= MIN && was < MIN) render();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', () => {
            handle.removeEventListener('pointermove', move);
            if (width < MIN) setWidth(0); else render();
        }, { once: true });
    });
}
