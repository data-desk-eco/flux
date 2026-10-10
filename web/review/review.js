// the attribution review page: each new claim on a map, and a verdict on it
// posted to worker/review.js

import { sql } from '../shell/data.js';
import { initArchive } from '../shell/archive.js';
import { addCandidateLayers, selectPlume } from '../methane/candidates.js';
import { initMask, showMask, clearMask } from '../methane/mask.js';
import { createMap, addSatellite, ensureMark } from '../shell/map.js';
import { logo } from '../shell/ui.js';
import { hover } from '../vendor/dd/dd.js';
import { escapeHtml as esc } from '../shell/util.js';
import { DD, MARK, MARKS, PIN, RATE_LABEL, DASH, plumeIcon }
    from '../layers.js';

const BUCKET = 'https://s3.WAW3-2.cloudferro.com/data-desk-archive/';
const API = 'api/decisions';
initArchive(BUCKET);
const all = new URLSearchParams(location.search).has('all');
const km = r => 111.2 * Math.hypot(r.lat - r.plat,
    (r.lon - r.plon) * Math.cos(r.lat * Math.PI / 180));
const $ = id => document.getElementById(id);
document.body.insertAdjacentHTML('beforeend', logo);

const [rows, decided] = await Promise.all([sql(`
    select a.*, strftime(a.run_at, '%Y-%m-%d %H:%M') as run,
           strftime(a.run_at, '%Y-%m-%d %H:%M:%S') as run_s,
           p.provider as pprov, p.satellite, p.date::varchar as pdate,
           p.rate_kg_h, p.lat as plat, p.lon as plon
    from read_parquet('${BUCKET}data-desk/attributions/data.parquet') a
    left join (select * from read_parquet([${['carbon-mapper', 'imeo', 'sron',
        'data-desk'].map(p => `'${BUCKET}${p}/detections/data.parquet'`)}],
        union_by_name = true) where kind = 'plume') p using (id)
    ${all ? '' : "where a.verified is distinct from 'grandfathered'"}
    order by a.run_at desc, p.date desc, a.id`),
    fetch(API).then(r => r.json()).catch(() => [])]);

// a verdict given here is the claim's state at once: the table catches up
// within the quarter hour. `open` is a verdict taken back
const key = r => r.id + '|' + r.run_s;
const dec = new Map(decided.map(d => [d.id + '|' + d.run_at, d]));
const state = r => {
    const d = dec.get(key(r));
    const v = d ? d.verdict : r.verified;
    return v === 'open' || v === 'grandfathered' ? null : v;
};
const TABS = {
    open: { label: 'To review', rows: () => rows.filter(r => !state(r)) },
    done: { label: 'Reviewed', rows: () => rows
        .filter(r => dec.get(key(r)) && state(r))
        .sort((a, b) => dec.get(key(b)).at.localeCompare(dec.get(key(a)).at)) },
};
const VERB = { confirmed: 'Confirm', refuted: 'Refute', unclear: 'Unclear' };

// information rows: the label left, the data right (pdf:84)
const stat = (k, v) => v ? `<dd-row><span class="fx-secondary">${k}</span>
    <span>${v}</span></dd-row>` : '';
const where = r => r.plat == null ? 'Unknown' : km(r) < 0.05
    ? 'On the plume' : `${km(r).toFixed(2)} km from the plume`;
function inner(r) {
    const v = state(r), d = dec.get(key(r));
    return `<div class="rv-head"><span>${esc(r.source_label)}</span>
        <span class="fx-secondary">${esc(v ?? r.confidence)}</span></div>
    <div class="rv-stats">
        ${stat('Kind', esc(r.source_kind))}
        ${stat('Confidence', v && esc(r.confidence))}
        ${stat('Operator', esc(r.operator))}
        ${stat('Register', r.operator_id && `${esc(r.operator_name)}
            (${esc(r.operator_id)})`)}
        ${stat('Plume', [r.pprov, r.satellite, r.pdate].filter(Boolean)
            .map(esc).join(' · '))}
        ${stat('Rate', r.rate_kg_h && `${Math.round(r.rate_kg_h)
            .toLocaleString()} kg/h`)}
        ${stat('Source', where(r))}
        ${stat('Features', r.attributed_ids?.length && esc(r.attributed_ids
            .slice(0, 3).join(', ')) + (r.attributed_ids.length > 3
            ? ` and ${r.attributed_ids.length - 3} more` : ''))}
        ${stat('Run', esc(r.run))}
        ${stat('Verdict', v && d && `${esc(v)}, ${esc(d.by)},
            ${esc(d.at.slice(0, 16).replace('T', ' '))}`)}
        <div class="fx-secondary">${esc(r.id)}</div></div>
    <div class="rv-why">${esc(r.paragraph)}</div>
    ${r.evidence?.length ? `<div class="rv-ev">${r.evidence.map((u, i) =>
        `<a href="${esc(u)}" title="${esc(u)}" target="_blank"
            rel="noopener">[${i + 1}]</a>`).join('')}</div>` : ''}
    <details class="rv-tx"><summary>Transcript</summary>
        <div class="rv-tx-body">Loading</div></details>
    <textarea class="rv-notes" rows="2" placeholder="Notes">${
        esc(d?.notes ?? '')}</textarea>
    <dd-btns>${Object.entries(VERB).map(([k, l]) =>
        `<dd-btn data-v="${k}"${v === k ? ' disabled' : ''}>${l}</dd-btn>`)
        .join('')}${v ? '<dd-btn data-v="open">Reopen</dd-btn>' : ''}
    </dd-btns>`;
}

// what the agent did, published per plume beside the table by the run
const JOB = { plume_source: 'Finding the source',
              claim_operator: 'Matching the operator' };
const KIND = { think: 'Reasoning', say: 'Wrote', search: 'Searched',
               results: 'Found', run: 'Ran', out: 'Output',
               answer: 'Answered', error: 'Error' };
function transcript(events) {
    let head;
    return events.map(e => {
        const h = (JOB[e.job] ?? e.job)
            + (e.attempt > 1 ? `, attempt ${e.attempt}` : '');
        const text = e.kind === 'results' ? e.text.split('\n').map(l => {
            const [title, url] = l.split('\t');
            return `<a href="${esc(url)}" target="_blank" rel="noopener">${
                esc(title || url)}</a>`;
        }).join('') : esc(e.text);
        return (h === head ? ''
            : `<div class="rv-head">${esc(head = h)}</div>`)
            + `<div class="rv-tx-${e.kind}"><span class="fx-secondary">${
                KIND[e.kind] ?? e.kind}</span>\n${text}</div>`;
    }).join('');
}
async function openTranscript(d) {
    if (!d.open || d.dataset.read) return;
    d.dataset.read = 1;
    const r = shown[d.closest('.rv-item').dataset.i];
    const body = d.querySelector('.rv-tx-body');
    const res = await fetch(`${BUCKET}data-desk/transcripts/${
        encodeURIComponent(r.id)}.json`).catch(() => null);
    body.innerHTML = res?.ok ? transcript(await res.json())
        : res?.status === 404 || res?.status === 403
            ? 'No transcript for this claim.' : 'The transcript did not load.';
}

const list = $('list');
let tab = 'open', shown = [], sel;
function tabs() {
    $('tabs').setAttribute('value', tab);
    $('tabs').innerHTML = Object.entries(TABS).map(([k, t]) =>
        `<button value="${k}">${t.label} ${view(t.rows()).length}</button>`)
        .join('');
    $('tabs').render();
}
// the view over a tab: the tab's own order unless another is asked for,
// newest plume or highest rate first, a plume without either last
const by = { date: r => r.pdate ?? '', rate: r => r.rate_kg_h ?? -1 };
function view(rows) {
    const f = $('view'), k = by[f.order.value];
    const cs = [...f.querySelectorAll('[data-c].on')].map(b => b.dataset.c);
    rows = rows.filter(r => cs.includes(r.confidence)
        && (!f.feat.checked || r.attributed_ids?.length));
    return k ? rows.sort((a, b) => k(b) > k(a) ? 1 : k(b) < k(a) ? -1 : 0)
        : rows;
}
function render(t) {
    tab = t, sel = null, shown = view(TABS[t].rows());
    list.innerHTML = shown.map((r, i) =>
        `<article class="rv-item" data-i="${i}">${inner(r)}</article>`).join('')
        || `<p class="fx-secondary rv-none">${t === 'open'
            ? 'No claims await a verdict.' : 'No verdicts yet.'}</p>`;
    list.scrollTop = 0;
    tabs();
    select(list.querySelector('.rv-item'));
}

// the plume in the quantitative marking on the main map's ramp, the claimed
// source in its attributed diamond, and a fine dash between: the link is
// the claim, not a measurement
const map = createMap({ center: [0, 20], zoom: 2 });
const empty = { type: 'FeatureCollection', features: [] };
const pt = (lon, lat, p) => ({ type: 'Feature', properties: p,
    geometry: { type: 'Point', coordinates: [lon, lat] } });
await new Promise(r => map.once('load', r));
addSatellite(map);
// the panel covers the left of the map, so the camera centres on the rest
map.setPadding(innerWidth > 768 ? { left: 410 }
    : { bottom: innerHeight * .55 });
MARKS.forEach(id => ensureMark(map, id));
map.addSource('rv', { type: 'geojson', data: empty });
// the other structures around the plume, under the claim: the sources the
// reviewer might have picked instead. the claimed one is drawn below as the
// claim's own diamond, so it is left out here
addCandidateLayers(map, sql, null);
for (const l of ['candidates', 'candidates-hit'])
    map.setFilter(l, ['!', ['get', 'hl']]);
initMask(map, BUCKET, 'candidates-hit');
map.addLayer({ id: 'rv-link', type: 'line', source: 'rv',
    filter: ['==', '$type', 'LineString'],
    paint: { 'line-color': DD.white, 'line-width': 1,
             'line-dasharray': DASH } });
map.addLayer({ id: 'rv-source', type: 'symbol', source: 'rv',
    filter: ['==', 'kind', 'source'], layout: { ...PIN, ...RATE_LABEL,
        'icon-image': MARK.attributed, 'text-allow-overlap': true,
        // below the plume's label, which takes the dd up-and-right
        'text-anchor': 'top-left', 'text-offset': [0.7, 0.7],
        'text-field': ['get', 'label'] },
    paint: { 'text-color': DD.white } });
// the claimed source's tooltip, in the candidates' own form
hover(map, 'rv-source', p => {
    const kind = (p.label || '').replace(/_/g, ' ');
    return { heading: p.name || kind, text: `${['attributed', kind, p.operator]
        .filter(v => v && v !== p.name).join(' · ')}\n${p.ids ?? ''}` };
});
map.addLayer({ id: 'rv-plume', type: 'symbol', source: 'rv',
    filter: ['==', 'kind', 'plume'], layout: { ...PIN, ...RATE_LABEL,
        'icon-image': plumeIcon, 'text-allow-overlap': true,
        'text-field': ['get', 'label'] },
    paint: { 'text-color': DD.white } });

function select(el, scroll) {
    if (!el) return map.getSource('rv').setData(empty);
    if (el === sel) return;
    sel?.classList.remove('on');
    (sel = el).classList.add('on');
    if (scroll) list.scrollTo({ top: el.offsetTop - list.offsetTop,
                                behavior: 'smooth' });
    const r = shown[el.dataset.i];
    // the source drawn first, so a plume on its coordinate shows on top
    const f = [pt(r.lon, r.lat, { kind: 'source', label: r.source_kind,
        name: r.source_label, operator: r.operator,
        ids: r.attributed_ids?.join(' ') })];
    if (r.plat != null) f.push(pt(r.plon, r.plat, { kind: 'plume',
        rate_kg_h: r.rate_kg_h, label: r.rate_kg_h
            ? `${Math.round(r.rate_kg_h).toLocaleString()} kg/h` : 'plume' }),
        { type: 'Feature', properties: {}, geometry: { type: 'LineString',
            coordinates: [[r.plon, r.plat], [r.lon, r.lat]] } });
    map.getSource('rv').setData({ type: 'FeatureCollection', features: f });
    r.plat != null ? showMask({ id: r.id, lat: r.plat, lon: r.plon })
        : clearMask();
    if (r.plat != null) selectPlume(r.plon, r.plat,
        /tropomi|viirs|goes|s3/i.test(r.satellite || '') ? 10 : 3, r);
    const b = new maplibregl.LngLatBounds([r.lon, r.lat], [r.lon, r.lat]);
    if (r.plat != null) b.extend([r.plon, r.plat]);
    // the globe's fitBounds overshoots maxZoom, so the zoom is clamped here:
    // past 15 esri's imagery runs out at many sites
    const c = map.cameraForBounds(b, { padding: 120 });
    map.easeTo({ center: c.center, zoom: Math.min(c.zoom, 15), duration: 600 });
}

// a verdict collapses the claim where it sits, so the list does not move
// under the reader; it changes tab on the next render. a collapsed claim
// opens again on a click, to change or reopen it
async function decide(verdict) {
    const el = sel, r = shown[el.dataset.i];
    if (verdict === 'open' && !state(r)) return;
    const btns = el.querySelectorAll('dd-btn');
    btns.forEach(b => b.toggleAttribute('disabled', true));
    const notes = el.querySelector('textarea').value.trim();
    const res = await fetch(API, { method: 'POST', body: JSON.stringify({
        id: r.id, run_at: r.run_s, verdict, notes }) })
        .catch(e => ({ ok: false, text: () => e.message }));
    btns.forEach(b => b.removeAttribute('disabled'));
    if (!res.ok) return $('tabs').insertAdjacentHTML('afterend',
        `<span style="color:var(--dd-map-red)">Not saved: ${
            esc(await res.text())}</span>`);
    dec.set(key(r), { id: r.id, run_at: r.run_s, verdict, notes: notes || null,
        by: dec.get(key(r))?.by ?? 'you', at: new Date().toISOString() });
    el.innerHTML = inner(r);
    tabs();
    // reopened in the queue, a claim stays open where it is to be judged again
    if (verdict === 'open' && tab === 'open') return;
    if (verdict === 'open') el.querySelector('.rv-head .fx-secondary')
        .textContent = 'reopened';
    el.classList.add('done');
    const items = [...list.querySelectorAll('.rv-item:not(.done)')];
    select(items.find(n => +n.dataset.i > +el.dataset.i) ?? items[0], true);
}

// scrolling picks the claim nearest the top of the list
list.addEventListener('scroll', () => {
    const top = list.getBoundingClientRect().top + 40;
    select([...list.querySelectorAll('.rv-item')].findLast(n =>
        n.getBoundingClientRect().top <= top)
        ?? list.querySelector('.rv-item'));
}, { passive: true });
list.addEventListener('click', e => {
    const el = e.target.closest('.rv-item');
    if (!el) return;
    if (e.target.dataset.v) return select(el), decide(e.target.dataset.v);
    if (el.classList.contains('done')) {
        el.classList.remove('done');
        return select(el);
    }
    if (!e.target.closest('a, textarea, details')) select(el, true);
});
// toggle does not bubble, so the list listens for it on the way down
list.addEventListener('toggle', e => e.target.matches?.('.rv-tx')
    && openTranscript(e.target), true);
$('tabs').addEventListener('change', e => render(e.target.value));
$('view').addEventListener('change', () => render(tab));
$('view').addEventListener('click', e => e.target.dataset.c
    && (e.target.classList.toggle('on'), render(tab)));
render('open');
