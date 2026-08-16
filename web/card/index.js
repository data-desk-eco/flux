// the detail card: one header, one body per feature kind.
//
// cartograph renders the header — title, coordinates, overlap nav — and calls
// the hooks below; everything under it comes from the body the feature's `kind`
// selects: an s2 flare site, a vnf flare or a methane plume. what the three
// share lives here — the "also here" row, the information rows, the intensity
// chart, the dated row list, the imagery overlays, and the selection
// bookkeeping that survives a re-cluster.
//
// dispatch is on the feature, so a card opened from "also here" is the kind it
// names — the two flaring families draw at once and each owns its own source.

import { showDetail, refreshDetail, closeDetail } from '../vendor/cartograph/detail.js';
import { dimSatellite } from '../vendor/cartograph/shell.js';
import { dateInQuarters, degLat, degLon, formatDate } from '../vendor/cartograph/util.js';
import { rampRGB, scaleT, chartNorm } from '../flaring/render.js';
import { nearbyHtml, wireNearby } from '../nearby.js';
import flare from './flare.js';
import vnf from './vnf.js';
import plume from './plume.js';

// the registry. the two flaring feature builders stamp their kind and a plume
// row carries `kind` from the detections table, so nothing here infers one.
const BODIES = { flare, vnf, plume };
const bodyOf = p => BODIES[p.kind] ?? BODIES.flare;

// injected by initCard: the map, whether this build serves the precomputed
// archive (its cluster rows carry no COG) and the active quarter-keys getter
export let map = null, hasArchive = false;
let quarterKeys = () => new Set();

export let current = null;          // the open feature's properties
export let currentDets = [];        // the series the card lists (csv reads it)
export let selectedDetection = null;
let shownBody = null;
let _skipAuto = false;              // suppress auto imagery load on a re-render

export function initCard(deps) {
    ({ map, hasArchive, quarterKeys } = deps);
    for (const b of Object.values(BODIES)) b.init?.(deps);

    // j/k / arrows step the dated rows. escape is cartograph's, and no card
    // carries a close control (ruling 2026-07-08). rows the body dimmed are
    // skipped — an l1c-only date has no image to open.
    document.addEventListener('keydown', e => {
        if (!document.getElementById('detail').classList.contains('visible')) return;
        let dir = 0;
        if (e.key === 'ArrowDown' || e.key === 'j') dir = 1;
        else if (e.key === 'ArrowUp' || e.key === 'k') dir = -1;
        if (!dir) return;
        e.preventDefault();
        const items = [...document.querySelectorAll('.event-item:not(.l1c-only)')];
        if (!items.length) return;
        const at = items.findIndex(el => el.classList.contains('active'));
        const next = Math.max(0, Math.min(items.length - 1, at + dir));
        if (next === at) return;
        items[next].click();
        items[next].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

export const coords = p => [Number(p.lon), Number(p.lat)];
const featureOf = p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords(p) }, properties: p });

// "Near <terminal>" where one is close enough to name the site (clustering.js)
export const siteTitle = (p, fallback) => ({
    text: (p.terminal ? `Near ${String(p.name).replace(/\s*Terminal\b/gi, '').trim()}` : p.name)
        || fallback,
});

// ── detail hooks ──

export const cardTitle = p => bodyOf(p).title(p);
// the "also here" row goes in a slot of its own because it is the one part of
// the card that reads other layers: they re-read on their own schedule, and the
// card cannot re-render itself for them (detail.js makes an unchanged feature a
// no-op, and rightly — a re-render would drop the reader's selected date). so
// the slot is refilled in place instead. empty it collapses, or the card's 38px
// section gap would open under a row that is not there.
export function cardHtml(p) {
    const b = bodyOf(p);
    return `<div id="nearby-slot">${nearbyHtml(p)}</div>` + (b.html ?? seriesHtml)(p, b);
}

function refreshNearbyRow() {
    const slot = document.getElementById('nearby-slot');
    if (!slot || !current) return;
    slot.innerHTML = nearbyHtml(current);
    wireNearby(slot);
}

export function onCardShow(p, el) {
    const b = bodyOf(p);
    // a selection that crosses families never fires onClose, so the outgoing
    // body takes its own map state down — the flare card's imagery and grey
    // circles, the plume card's candidates and probability overlay — while a
    // re-render of the same kind leaves both alone
    if (shownBody && shownBody !== b) closeBody(shownBody);
    shownBody = b;
    current = p;
    selectedDetection = null;
    wireNearby(el);
    (b.show ?? seriesShow)(p, el, b);
    document.activeElement?.blur();
}

const closeBody = b => (b.close ?? seriesClose)();

export function onCardClose() {
    if (shownBody) closeBody(shownBody);
    shownBody = null;
    current = null;
    currentDets = [];
    selectedDetection = null;
}

// ── selection maintenance across re-renders ──

// a re-render must not pull the reader's selected date back to the first row
const rerender = fn => { _skipAuto = true; fn(); _skipAuto = false; };
const reopen = p => rerender(() => showDetail(featureOf(p), true));

// re-filter the open card to the current quarter window (map reconciles async).
// the properties don't move, only the window they're read through, so this is
// the forced re-render — showDetail alone would see an unchanged card
export function refreshCard() {
    if (current) rerender(refreshDetail);
}

// re-open the card on the rebuilt feature after a re-cluster or a re-read
// (geojson sources keep the last data set on `_data`), or close it. every
// refresh path ends here: a dot carries the numbers for the ticked quarters
// alone and an open card holds a copy, not a reference.
export function reselectCurrentFeature() {
    if (!current || !shownBody) return;
    const features = map.getSource(shownBody.source)?._data?.features || [];
    // on the identifier, not on coordinates: an 11 m coordinate match handed two
    // close sites each other's card. ids are VARCHAR in every table, so compare
    // as strings and never coerce with Number()
    const match = features.find(f => String(f.properties.id) === String(current.id));
    // the row second: reopen rebuilds it when the feature moved, and does
    // nothing at all when only another layer did
    if (match) { reopen(match.properties); refreshNearbyRow(); }
    // absent from a viewport that does not reach it is not the same as filtered
    // out of one that does, and only the second is grounds for closing. a
    // #site= link opens a card the initial viewport never read and then flies
    // to it; the refresh in between used to close the card it had just opened.
    else if (map.getBounds().contains(coords(current))) closeDetail();
}

// ── the flaring body: information rows, chart, dated rows, action pair ──

// a locally detected cluster carries its own dates; an archive row does not,
// and the presence of the property is what tells them apart. detections arrive
// as objects from crossDateCluster or json strings via queryRenderedFeatures
function localDets(p) {
    if (!p.detections) return null;
    let d = p.detections;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = []; } }
    return d;
}

function seriesHtml(p, b) {
    const cfg = b.cfg;
    // both archive tables publish the window's numbers on the feature — the
    // looks they published for the ticked quarters, and the detections in
    // exactly those looks — so nothing here recomputes a rate. only a locally
    // detected cluster needs its count derived, from the dates it carries,
    // because nothing rolled it up.
    const local = localDets(p);
    const detection_count = local
        ? local.filter(d => dateInQuarters(d.date, quarterKeys())).length
        : p.detection_count;
    const cfLabel = p.passes && p.observations != null
        ? `Cloud-free (${Math.round(p.observations / p.passes * 100)}%)` : 'Cloud-free obs.';
    // the count is the passes we could see the site and it was lit — fewer than
    // the dates listed below, which include cloudy ones — over the passes an
    // instrument flew and we read the sky. the four read as one chain.
    const stats = [
        // "(clear)" only where a cloud mask says which passes were clear:
        // without one the count and the rate below it run over every pass
        [local || p.observations == null ? 'Detections' : 'Detections (clear)', detection_count],
        ['Persistence', p.persistence != null ? `${Math.round(p.persistence * 100)}%` : '—'],
        [b.passLabel, p.passes ?? '—'],
        [cfLabel, p.observations ?? '—'],
    ].map(([k, v]) => `<div><span class="dd-secondary">${k}</span><span>${v}</span></div>`).join('');
    return `
        <div class="info-stats">${stats}</div>
        <div class="intensity-chart" id="intensity-chart"></div>
        <div class="events">
            <div class="events-header dd-secondary">
                <span>Date</span>
                <span class="col-right col-val">${cfg.col2}</span>
                <span class="col-right col-count">${cfg.col3}</span>
            </div>
            <div class="events-list custom-scroll" id="events-list"></div>
        </div>
        ${b.actions ? `<div class="dd-btn-pair panel-actions">${b.actions}</div>` : ''}`;
}

function seriesShow(p, el, b) {
    greyCircles(true);
    // the card shows only detections in the selected quarter window. archive
    // features carry no embedded list — the series is fetched per site, here,
    // so the big detections parquet (and its footer) loads lazily behind the
    // card. a failed fetch says so; it used to sit on 'Loading…' for good.
    const qKeys = quarterKeys();
    const local = localDets(p);
    if (local) renderEvents(el, local.filter(d => dateInQuarters(d.date, qKeys)), b);
    else {
        el.querySelector('#events-list').innerHTML = '<div class="events-empty">Loading…</div>';
        b.fetch(p)
            .then(dets => dets.filter(d => dateInQuarters(d.date, qKeys)))
            .catch(err => { console.error('detection series error:', err); return []; })
            .then(dets => { if (current === p) renderEvents(el, dets, b); });
    }
    b.wire?.(el);
}

function seriesClose() {
    clearCogLayers();
    dimSatellite(map, false);
    greyCircles(false);
}

function renderEvents(el, detections, b) {
    currentDets = detections;
    const list = el.querySelector('#events-list');
    list.innerHTML = '';
    const sorted = [...detections].sort((a, b) => new Date(b.date) - new Date(a.date));
    const dateToItem = new Map();
    let firstItem = null;

    for (const det of sorted) {
        const item = document.createElement('div');
        // a row with no image to open is dimmed and skipped, not dropped: it
        // still carries a date and a raw point for the intensity halo
        const dim = b.l1c?.(det);
        item.className = 'dd-row event-item' + (dim ? ' l1c-only' : '');
        item.dataset.date = det.date;
        item.innerHTML = `
            <span class="event-date">${formatDate(det.date)}</span>
            <span class="event-meta event-meta-val">${b.cfg.formatVal(det)}</span>
            <span class="event-meta event-meta-count">${b.cfg.formatCount(det)}</span>`;
        item.onclick = () => selectDetection(det, item, b);
        list.appendChild(item);
        dateToItem.set(det.date, { det, item });
        if (!firstItem && !dim) firstItem = { det, item };
    }

    renderIntensityChart(el, detections, b.cfg, det => {
        const entry = dateToItem.get(det.date);
        if (entry) {
            selectDetection(entry.det, entry.item, b);
            entry.item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    const MAX_VISIBLE_ROWS = window.innerWidth <= 768 ? 4 : 10;
    const items = list.querySelectorAll('.event-item');
    if (items.length > 0) {
        list.style.maxHeight = (items[0].offsetHeight * Math.min(items.length, MAX_VISIBLE_ROWS)) + 'px';
    } else {
        el.querySelector('#intensity-chart').innerHTML = '';
        list.innerHTML = '<div class="events-empty">No detections</div>';
    }

    if (firstItem && !_skipAuto) selectDetection(firstItem.det, firstItem.item, b);
}

function selectDetection(det, item, b) {
    document.querySelectorAll('.event-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    selectedDetection = det;
    b.select(det);
}

// ── intensity chart ──

function renderIntensityChart(el, detections, cfg, onSelectDate) {
    const container = el.querySelector('#intensity-chart');
    if (!detections?.length) { container.innerHTML = ''; return; }

    const sorted = [...detections].sort((a, b) => new Date(a.date) - new Date(b.date));
    const margin = { top: 8, right: 8, bottom: 16, left: 8 };
    const width = 268, height = 50;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const dates = sorted.map(d => new Date(d.date));
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const dateRange = maxDate - minDate || 1;

    let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`;
    svg += `<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#808080" stroke-width="1"/>`;

    const firstYear = new Date(minDate).getFullYear();
    const lastYear = new Date(maxDate).getFullYear();
    for (let y = firstYear + 1; y <= lastYear; y++) {
        const jan1 = new Date(y, 0, 1).getTime();
        const x = margin.left + ((jan1 - minDate) / dateRange) * innerW;
        svg += `<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#4D4D4D" stroke-width="0.5"/>`;
        svg += `<text x="${x}" y="${height - 2}" fill="#808080" font-size="8" text-anchor="middle">${y}</text>`;
    }

    sorted.forEach((det, i) => {
        const date = new Date(det.date);
        const x = margin.left + ((date - minDate) / dateRange) * innerW;
        const val = cfg.yVal(det);
        if (cfg.sentinel && val >= cfg.sentinel) return;
        const t = Math.max(0, Math.min(1, chartNorm(cfg, val)));
        const y = margin.top + innerH - t * innerH;
        svg += `<circle class="chart-dot" cx="${x}" cy="${y}" r="2.5" fill="#FFFFFF" data-idx="${i}"/>`;
    });

    container.innerHTML = svg + '</svg>';
    container.querySelectorAll('.chart-dot').forEach(dot => {
        dot.addEventListener('click', e => onSelectDate(sorted[parseInt(e.target.dataset.idx)]));
    });
}

// ── map overlays shared by the flaring bodies ──

// both flaring layers, because imagery under one of them is imagery under the
// other: they draw the same place from two instruments
function greyCircles(grey) {
    for (const id of ['detections', 'vnf'])
        if (map.getLayer(id)) map.setPaintProperty(id, 'icon-opacity', grey ? 0.35 : 1);
}

// tear down the COG / heat-footprint image overlay (idempotent)
export function clearCogLayers() {
    if (map.getLayer('cog-border')) map.removeLayer('cog-border');
    if (map.getLayer('cog-layer')) map.removeLayer('cog-layer');
    if (map.getSource('cog-border')) map.removeSource('cog-border');
    if (map.getSource('cog-source')) map.removeSource('cog-source');
}

// put a georeferenced canvas under the detection markings, optionally framed
export function drawImage(coordinates, url, { border, resampling = 'linear' } = {}) {
    map.addSource('cog-source', { type: 'image', url, coordinates });
    map.addLayer({ id: 'cog-layer', type: 'raster', source: 'cog-source',
        paint: { 'raster-opacity': 1, 'raster-resampling': resampling } }, 'detections');
    if (border) {
        map.addSource('cog-border', { type: 'geojson', data: { type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] } } });
        map.addLayer({ id: 'cog-border', type: 'line', source: 'cog-border',
            paint: { 'line-color': '#ffffff', 'line-width': 1 } }, 'detections');
    }
    greyCircles(true);
    dimSatellite(map, true);
}

// radial-gradient footprint at a detection's point, coloured and sized by
// intensity, where there is no COG to render: vnf looks and s2 archive rows.
// each family passes its own quantity — radiant heat and B12 reflectance are
// not comparable, only their places on the shared ramp are.
export function heatFootprint({ lon, lat, val, radiusM, cfg }) {
    clearCogLayers();
    if (!(val > 0)) return;

    const dLat = degLat(radiusM), dLon = degLon(radiusM, lat);

    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const [r, g, b] = rampRGB(scaleT(cfg, val));
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
    grad.addColorStop(0.3, `rgba(${r},${g},${b},0.5)`);
    grad.addColorStop(0.7, `rgba(${r},${g},${b},0.15)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    drawImage([[lon - dLon, lat + dLat], [lon + dLon, lat + dLat],
               [lon + dLon, lat - dLat], [lon - dLon, lat - dLat]], canvas.toDataURL());
}
