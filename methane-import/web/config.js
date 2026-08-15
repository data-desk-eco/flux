// firedamp on cartograph — everything firedamp-specific is this config plus
// two hook modules: attribution.js (static attribution + wind) and
// candidates.js (the provider-owned `infrastructure` tables).

import { mount } from './vendor/cartograph/app.js';
import { initArchive, objects } from './vendor/cartograph/archive.js';
import { map as dd } from './vendor/dd/palette.js';
import { escapeHtml } from './vendor/cartograph/util.js';
import { loadAttributions, enrich } from './attribution.js';
import { addCandidateLayers, clearSelection } from './candidates.js';
import { LICENCE_LAYERS, addLicenceLayers } from './licences.js';
import { clearProbabilityOverlay, initProbabilityOverlay, showProbabilityOverlay } from './overlay.js';

// the datadesk-only deploy (dist.sh local mode, behind cloudflare access) and
// localhost. it bakes a plumes parquet carrying ghgsat and is the only place
// mapstand licence acreage — licensed data — is drawn.
const PRIVATE = location.hostname === 'localhost' || document.querySelector('meta[name="private"]');

const bucket = document.querySelector('meta[name="data-bucket"]')?.content;
// the archive states which providers publish `detections` and `infrastructure`,
// so neither this file nor candidates.js carries a provider list. one fetch of a
// ~640 byte object, started here at module parse so it overlaps the duckdb boot.
initArchive(bucket).catch(() => {});   // the real handler is in sources()
const PLUMES = PRIVATE
    ? 'data/plumes.parquet' : null;
// attributions live on the store too (ch4id `sync push` exports the contract)
const ATTRIBUTIONS = `${bucket}/data-desk/attributions/data.parquet`;

// a colour and a label are editorial, so they are stated here. which providers
// exist is not, so it is not: a provider the archive adds lands on the map in
// white, under its own name, with no edit to this file.
const COLOR = { 'carbon-mapper': dd.adjusted.cyan, imeo: dd.adjusted.magenta, sron: dd.adjusted.yellow, ghgsat: dd.adjusted.orange, 'data-desk': dd.adjusted.green };
const LABEL = { 'carbon-mapper': 'Carbon Mapper', imeo: 'IMEO / MARS', sron: 'SRON', ghgsat: 'GHGSat', 'data-desk': 'Data Desk' };
const SRCS = Object.keys(COLOR);
const PRIVATE_SRCS = new Set(['ghgsat']);   // only ever in the private deploy's baked parquet
const color = p => COLOR[p] ?? dd.adjusted.white;
const label = p => LABEL[p] ?? p;
const SECTOR = { og: 'Oil & Gas', coal: 'Coal', waste: 'Waste', other: 'Other' };
// everything the map, key, table and detail panel read — the projection stays
// narrow because every column rides into 70k geojson features
const PLUME_COLS = ['id', 'provider', 'date', 'lat', 'lon', 'rate_kg_h',
    'rate_std_kg_h', 'satellite', 'sector', 'link', 'overlay', 'bounds'];
// `detections` holds flares as well as plumes, and a data-desk retrieval the
// producer does not trust rides along with valid = false
const PLUME_WHERE = { kind: ['plume', 'plume'], valid: [true, true] };

// dd flare marking, one size for every plume (rate lives in the key filter
// and the data table); grows gently with zoom, the burnoff ramp
const ICON = ['interpolate', ['linear'], ['zoom'], 2, 0.55, 10, 0.8, 14, 1];

// null when the provider published no rate estimate
const rateT = p => p.rate_kg_h == null ? null : (Number(p.rate_kg_h) / 1000).toFixed(1);

function sourceUrl(p) {
    if (!p.id) return null;
    if (p.provider === 'carbon-mapper') return `https://data.carbonmapper.org/?plume_id=${encodeURIComponent(p.id)}`;
    if (p.provider === 'sron' && p.link) return `https://ftp.sron.nl/pub/memo/CSVs/${encodeURIComponent(p.link)}`;
    if (p.provider === 'data-desk' && p.link)
        return /^https?:/.test(p.link) ? p.link : `${bucket}/${p.link.replace(/^\//, '')}?v=viridis`;
    return null;
}

function overlayUrl(p) {
    if (p.provider !== 'data-desk' || !p.overlay) return null;
    return /^https?:/.test(p.overlay) ? p.overlay : `${bucket}/${p.overlay.replace(/^\//, '')}?v=viridis`;
}

// a plume id carries its provider's namespace since the archive took the
// detection tables over: `c096faa6…` became `IMEO:c096faa6…`, and
// `sron_20250927_65.61N_25.19E` became `SRON:20250927:65.61N:25.19E`. a link
// somebody has already sent is the one thing a rename may not break, so the
// permalink resolves on the namespace-free form too — one canonical spelling,
// matched against the loaded features rather than a table of old ids.
let loaded;   // the plume collection, kept for resolve()
const canon = id => String(id).toLowerCase().replace(/_/g, ':').replace(/^[a-z]+:/, '');
const resolve = id => loaded?.features.find(f => canon(f.properties.id) === canon(id));

mount({
    title: 'Firedamp',
    badge: 'beta',
    subtitle: 'Methane plume aggregator',
    about: `<p>Firedamp aggregates satellite methane plume detections from
        <a href="https://carbonmapper.org" target="_blank" rel="noopener">Carbon Mapper</a>,
        UNEP's <a href="https://methanedata.unep.org" target="_blank" rel="noopener">International Methane Emissions Observatory</a>
        and <a href="https://earth.sron.nl/methane-emissions/" target="_blank" rel="noopener">SRON</a>,
        hosted by <a href="https://datadesk.eco" target="_blank" rel="noopener">Data Desk</a>.</p>
        <p>Recent plumes carry provisional attributions generated by the <a href="https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro" target="_blank" rel="noopener">DeepSeek V4 Pro</a> model.
        We run DeepSeek in a version of the <a href="https://pi.dev/" target="_blank" rel="noopener">pi</a>
        coding harness with access to a database of 15 million candidate sources from
        <a href="https://globalenergymonitor.org" target="_blank" rel="noopener">Global Energy Monitor</a>,
        <a href="https://www.edf.org" target="_blank" rel="noopener">EDF OGIM</a>,
        <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a> and
        <a href="https://mapstand.com" target="_blank" rel="noopener">MapStand</a>, as well as original raster data
        and geospatial analysis tools.</p>
        <p>This functionality is an experiment, and while results for high-resolution sensors such as Tanager-1
        are promising, attributions are more speculative for lower-resolution sensors like TROPOMI. Your feedback
        will help inform our work: <a href="mailto:hello@datadesk.eco">hello@datadesk.eco</a></p>`,
    search: true,
    map: { center: [10, 50], zoom: 4, minZoom: 1.5, maxZoom: 18 },
    data: {
        files: { ...(PRIVATE ? { plumes: PLUMES } : {}), attributions: ATTRIBUTIONS },
        prefetch: PRIVATE ? ['plumes'] : [],
    },

    sources: async ({ read, fc, map, sql }) => {
        // added here, not in ready(), so the key's visibility toggle has a
        // layer to read — and so licence acreage sits beneath every plume
        if (PRIVATE) addLicenceLayers(map, sql);
        // one object per provider, named from the index and read independently:
        // allSettled, so a provider whose object is missing costs its own rows
        // and nothing else — the property the glob used to give us. eog is not
        // among them because the index says its detections are partitioned, not
        // because this file knows anything about eog.
        const opts = { columns: PLUME_COLS, where: PLUME_WHERE };
        const [reads, attribs] = await Promise.all([
            PRIVATE ? Promise.allSettled([read('plumes', opts)])
                    : objects('detections')
                        .catch(err => (console.warn('archive index:', err), []))
                        .then(us => Promise.allSettled(us.map(u => read(u, opts)))),
            loadAttributions(),
        ]);
        for (const r of reads)
            if (r.status === 'rejected') console.warn('a detections source did not load:', r.reason);
        const plumes = reads.flatMap(r => r.status === 'fulfilled' ? r.value : []);
        for (const p of plumes) if (attribs.has(p.id)) p.attr = 1;
        // clusters only when far out — points take over from z5 (~UK-sized viewport)
        return { plumes: { data: loaded = fc(plumes), cluster: true, clusterMaxZoom: 4, clusterRadius: 30,
                           clusterProperties: { rate_sum: ['+', ['coalesce', ['get', 'rate_kg_h'], 0]] } } };
    },

    layers: [
        // one layer per styled provider, plus a catch-all: rows the index brings
        // in from a provider nobody has coloured yet are drawn in white under
        // their own name, rather than loaded and left invisible
        ...[...SRCS, null].map(src => ({
            id: `plumes-${src ?? 'other'}`, type: 'symbol', source: 'plumes',
            filter: ['all', ['!', ['has', 'point_count']], src
                ? ['==', ['get', 'provider'], src]
                : ['!', ['in', ['get', 'provider'], ['literal', SRCS]]]],
            hover: p => `<span class="dd-title">${rateT(p) ? `${rateT(p)} t/hr` : 'rate n/a'}</span><br>${label(p.provider)}${p.date ? ' · ' + p.date : ''}`,
            layout: {
                'icon-image': `flare-${color(src)}`,
                'icon-size': ICON,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                // t/hr up-and-right (dd label rule); colliding labels drop, icons
                // stay; rate-less plumes get no label
                'text-field': ['case', ['==', ['typeof', ['get', 'rate_kg_h']], 'number'], ['concat',
                    ['number-format', ['/', ['get', 'rate_kg_h'], 1000], { 'max-fraction-digits': 1 }], ' t/hr'], ''],
                'text-font': ['Montserrat Regular'], 'text-size': 10,
                'text-anchor': 'bottom-left', 'text-offset': [0.7, -0.7],
                'text-optional': true,
            },
            paint: { 'text-color': dd.adjusted.white },
        })),
        {
            // white default-state flare with total t/hr up-and-right (dd label rule)
            id: 'plumes-clusters', type: 'symbol', source: 'plumes',
            filter: ['has', 'point_count'],
            layout: {
                'icon-image': `flare-${dd.adjusted.white}`,
                'icon-size': ICON,
                'icon-allow-overlap': true, 'icon-ignore-placement': true,
                // round before formatting: maplibre drops a 0 'max-fraction-digits'
                'text-field': ['concat',
                    ['number-format', ['round', ['/', ['get', 'rate_sum'], 1000]], {}], ' t/hr'],
                'text-font': ['Montserrat Regular'], 'text-size': 10,
                'text-anchor': 'bottom-left', 'text-offset': [0.7, -0.7],
                'text-allow-overlap': true,
            },
            paint: { 'text-color': dd.adjusted.white },
        },
    ],

    filters: [
        {
            key: 'attr', label: 'Attribution', value: 'all',
            options: [{ value: 'all', label: 'All' }, { value: 'yes', label: 'Attributed' }],
            pred: v => v === 'yes' ? p => p.attr === 1 : null,
        },
        {
            key: 'date', label: 'Date', value: 'all',
            options: [{ value: 'all', label: 'All' }, { value: '2025', label: "'25" },
                      { value: '2026', label: "'26" }, { value: '60d', label: '-60d' }],
            pred: v => v === 'all' ? null
                : v === '60d' ? (cut => p => p.date >= cut)(new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10))
                : p => (p.date || '').startsWith(v),
        },
    ],

    key: ctx => [
        {
            // toggleable rate ranges: active rows OR into the data filter
            label: 'Rate (t/hr)',
            rows: [['10+', 10], ['5–10', 5, 10], ['1–5', 1, 5], ['< 1', 0, 1], ['n/a']].map(([label, lo, hi]) => ({
                swatch: { mark: 'flare', color: dd.adjusted.white }, label,
                pred: lo == null ? p => p.rate_kg_h == null
                    : p => p.rate_kg_h != null && p.rate_kg_h >= lo * 1000 && (!hi || p.rate_kg_h < hi * 1000),
            })),
        },
        {
            // source rows filter the data too, so clusters re-form without them
            label: 'Source',
            rows: [...SRCS, ...new Set(ctx.sources.plumes.features
                    .map(f => f.properties.provider).filter(p => !SRCS.includes(p)))]
                .filter(src => !PRIVATE_SRCS.has(src) || ctx.sources.plumes.features.some(f => f.properties.provider === src))
                .map(src => ({ swatch: { mark: 'flare', color: color(src) }, label: label(src), pred: p => p.provider === src })),
        },
        // layer toggle, not a data filter: licence areas aren't plumes
        ...(PRIVATE ? [{
            label: 'Licensing',
            rows: [{
                swatch: { ring: dd.adjusted.purple }, label: 'Licence areas (MapStand)',
                toggle: LICENCE_LAYERS,
            }],
        }] : []),
    ],

    table: [
        {
            label: 'Detections',
            rows: ({ sources }) => sources.plumes.features.map(f => f.properties),
            cols: ['id', 'provider', 'date', 'rate_kg_h', 'satellite', 'sector', 'lat', 'lon'],
        },
        {
            // rows aren't plume properties, so the legend preds don't apply
            label: 'Attributions', filter: false,
            rows: async ({ read }) => (await read('attributions', { cache: true,
                columns: ['id', 'source_label', 'source_kind', 'operator', 'confidence', 'lat', 'lon'] }))
                .sort((a, b) => String(a.source_label).localeCompare(String(b.source_label))),
            cols: ['id', 'source_label', 'source_kind', 'operator', 'confidence', 'lat', 'lon'],
        },
    ],

    detail: {
        layers: [...SRCS, 'other'].map(src => `plumes-${src}`),
        hashKey: 'plume', flyZoom: 15, resolve,
        title: p => ({ text: p.id || '—', href: sourceUrl(p) }),
        html: p => `
            <div class="fd-badges">
                <span style="color:${color(p.provider)}">${escapeHtml(label(p.provider))}</span>
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
        onShow: p => { enrich(p); showProbabilityOverlay(p, overlayUrl(p)); },
        onClose: () => { clearSelection(); clearProbabilityOverlay(); },
    },

    ready: ({ map, sql }) => { initProbabilityOverlay(map); addCandidateLayers(map, sql); },
});
