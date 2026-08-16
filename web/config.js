// flux on cartograph — one map, one date window, three detection layers. this
// config plus the hook modules: layers.js (marking/ramp/colour policy for every
// layer), card/ (one header and a body per feature kind), nearby.js (the "also
// here" row), flaring/ (render.js mode tables, detect.js local detect+p2p,
// s2archive.js / vnf.js readers, clustering.js feature builders) and methane/
// (plumes.js reader, attribution.js, candidates.js, licences.js, overlay.js,
// sweep.js viewport sweep).
//
// flaring is measured two ways and both are drawn at once, a layer each — s2
// (archive clusters, detect fallback) and vnf (viirs nightfire) — because the
// two instruments answer the same question from day and from night, and a
// toggle made the reader hold one answer in their head to compare it with the
// other. methane plumes are the third layer. the quarter dot grid drives all
// four: one window, and a quarter greys only when no layer covers it.
//
// what a toggle used to do the key does, per layer: each family's rows are its
// colour bands, so turning them all off takes that family off the map. that is
// also where the intensity gate went, which is what pays for the second layer
// in panel space.

import { mount } from './vendor/cartograph/app.js';
import { viewportBbox, boxesWorldmap, ensureMark } from './vendor/cartograph/shell.js';
import { padBbox, featureBbox, escapeHtml, formatDate, degLat, degLon } from './vendor/cartograph/util.js';
import { MODE } from './flaring/render.js';
import { DD, AREA, MARK, MARKS, PIN, RATE_LABEL, PLUME_BANDS, flareBands, flareIcon, plumeIcon } from './layers.js';
import { initArchive } from './vendor/cartograph/archive.js';
import { initVNF, resetVNF, queryVNF, queryVNFFlare, availableQuartersVNF, isReady as vnfReady } from './flaring/vnf.js';
import { initS2Archive, queryS2Archive, queryS2Flare, availableQuartersS2, isReady as s2ArchiveReady, isCovered, coverageTiles, whenCovered, residentFlares } from './flaring/s2archive.js';
import { initCard, cardTitle, cardHtml, onCardShow, onCardClose, refreshCard, reselectCurrentFeature } from './card/index.js';
import { initNearby, RADIUS_M } from './nearby.js';
import { setTerminals, archiveFeature, enrichVNFFeatures } from './flaring/clustering.js';
import { initPlumes, isPlume, label, rateT, readPlumes, availableQuartersPlumes, canon, readPlume } from './methane/plumes.js';
import { addCandidateLayers } from './methane/candidates.js';
import { LICENCE_LAYERS, addLicenceLayers } from './methane/licences.js';
import { initProbabilityOverlay } from './methane/overlay.js';

// legacy deep links: #vnf/123 -> #vnf=123 (cartograph hash params), which the
// site resolver then reads whichever family the id belongs to
if (/^#vnf\/[^/=&]+$/.test(location.hash))
    history.replaceState(null, '', location.hash.replace('/', '='));

// ---------------------------------------------------------------------------
// build config (index.html meta tags)
// ---------------------------------------------------------------------------

// both flaring layers read the datadesk archive (CloudFerro, public-read, remote range
// requests): vnf the eog tables, s2 the data-desk ones. the in-browser COG
// worker ("Detect") stays as the fallback for areas not yet archived. neither
// module names an object — index.json says which object each table is and
// whether it is partitioned, so a table that starts partitioning does not break
// a reader. fetched here at page parse, overlapping maplibre init.
const ARCHIVE = document.querySelector('meta[name="data-bucket"]')?.content || '';
if (ARCHIVE) { initArchive(ARCHIVE); initS2Archive(ARCHIVE); }

const MIN_ARCHIVE_ZOOM = 4;   // displaying precomputed archive clusters (cheap, in-memory)
const MIN_VNF_ZOOM = 6;
const MIN_DETECT_ZOOM = 11;   // local-worker COG detect (heavy) + its controls

// date span the quarter grid covers (last 4 calendar years) — bounds the vnf
// availability query so it stays cheap
const GRID_START = `${new Date().getFullYear() - 3}-01-01`;
const GRID_END = `${new Date().getFullYear()}-12-31`;

// the persistence gate is display-only (a layer filter, no re-cluster). the
// intensity gate that used to sit beside it is now MODE[x].floor, a constant:
// with both families drawn there is no one scale for one slider to carry, and
// the key's colour bands filter above the floor on each family's own units.
let PERSISTENCE_MIN = 0.25;

let CTX;                                    // cartograph ctx (set in sources)
let readyResolve;
const whenReady = new Promise(r => readyResolve = r);

// every refresh in this file is scheduled, never called on the event: a drag
// fires moveend once but a quarter click can arrive in bursts, and the reads
// behind these are viewport-wide
const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

// `rank` rather than `persistence`, because the two answer different questions:
// the card shows the rate over the quarters you picked, and the gate ranks the
// site. clustering.js falls the one back on the other, and leaves rank null for
// a site nothing rated.
//
// the two null branches stay split, and the last argument is where they split.
// in s2 a null is unrated: a rate gate cannot exclude a site whose rate we never
// measured without asserting one, so it passes. in vnf a null is a finding — no
// clear night — and the flare is dropped. each layer now carries its own rather
// than one expression asking which mode is up, which is the same split stated
// where it cannot be coalesced away.
//
// s2 held 0 here for a while, on the argument that scoring the unmeasured high
// lets a glint field through a 25% gate looking like a finding. the archive no
// longer has that shape: sql/tables/flares.checks.sql refuses to publish a table
// rating fewer than half its sites, and today 68 of 9603 rows are unrated, 29 of
// them past the intensity gate. what the 0 cost instead was every ras laffan
// site — the complex this repo keeps a monitoring doc for — with the quarter
// grid still lit, because availability counts detections and those quarters have
// them. blank map, controls saying otherwise, nothing in the console.
const persistenceFilter = (v, unrated) =>
    ['>=', ['coalesce', ['get', 'rank'], ['get', 'persistence'], unrated], v];
const applyPersistenceFilter = () => {
    CTX.map.setFilter('detections', persistenceFilter(PERSISTENCE_MIN, 1));
    CTX.map.setFilter('vnf', persistenceFilter(PERSISTENCE_MIN, 0));
};

// a source this app re-reads has to pass the key's live predicates itself:
// cartograph applies them when a key row is toggled, not when the data changes.
// keeping ctx.sources in step matters twice over — it is what cartograph re-sets
// from on the next toggle, and what detail's allFeatures() resolves against.
function setSource(id, features) {
    const all = CTX.sources[id] = { type: 'FeatureCollection', features };
    CTX.map.getSource(id)?.setData(CTX.preds.length
        ? { ...all, features: features.filter(f => CTX.preds.every(p => p(f.properties))) } : all);
    // the table drawer re-renders on this and on moveend; a window change moves
    // the data without moving the camera, so it has to be said
    dispatchEvent(new Event('cg-filters'));
}
const setDetections = features => setSource('detections', features);
const setVNF = features => setSource('vnf', features);

// ---------------------------------------------------------------------------
// the local detector, loaded on demand
// ---------------------------------------------------------------------------

// detect.js drags the clustering and scoring modules in with it — about 1,100
// lines a pure-archive session never runs — so it is imported at the moment its
// controls appear (outside coverage, or a covered viewport the archive has
// nothing for), and eagerly only in pure-detect builds. until then these stand
// in: nothing is detecting, nothing has been detected, and the only detections
// source is the archive's, so "redraw the local one" means clear it.
let D = {
    isDetecting: () => false,
    getDetectedQuarters: () => new Set(),
    updateDetectButton: () => {},
    updateDetectionSource: () => setDetections([]),
};
let _detect = null;
const ensureDetect = () => _detect ??= import('./flaring/detect.js')
    .then(m => {
        D = m;
        m.initDetect({
            map: CTX.map, quarters: CTX.quarters,
            render: renderDetections,
            updateQuarters: updateQuarterIndicators,
            minAvgB12: () => MODE.s2.floor,
            minZoom: MIN_DETECT_ZOOM,
        });
        return m.ensureDetect();
    })
    .catch(err => { _detect = null; console.error('detect init error:', err); });

// ---------------------------------------------------------------------------
// the vnf layer
// ---------------------------------------------------------------------------

// eog/flares is opened on the first viewport that could draw from it, not at
// mount: below MIN_VNF_ZOOM the layer reads nothing, so a zoomed-out session
// still pays no footer read. a failed init is cleared so the next pan retries.
let _vnfInit = null;
const ensureVNF = () => _vnfInit ??= initVNF().then(scheduleQuarterIndicators).catch(err => {
    console.error('VNF init error:', err);
    _vnfInit = null;
    resetVNF();
    // do not fail silently: no flares and no message was how a transient store
    // failure read as a dead layer
    CTX.quarters.hint('VNF unavailable');
});

async function refreshVNF() {
    if (CTX.map.getZoom() < MIN_VNF_ZOOM) { setVNF([]); return; }
    await ensureVNF();
    if (!vnfReady()) return;
    const range = CTX.quarters.range();
    if (!range) return;
    try {
        const fc = await queryVNF(viewportBbox(CTX.map), range.startDate, range.endDate);
        setVNF(enrichVNFFeatures(fc.features, MODE.vnf.floor));
        // an open card holds the previous window's aggregates, so reconcile it
        // against the re-query — otherwise a card keeps a persistence for
        // quarters that are no longer selected, and the '—' a window with no
        // clear night should show never appears
        reselectCurrentFeature();
    } catch (err) {
        console.error('VNF query error:', err);
        // transient store failures happen (short parquet reads); say so where
        // the reader is looking rather than leaving an empty map unexplained
        CTX.quarters.hint('VNF read failed');
    }
}

const scheduleVNFRefresh = debounce(refreshVNF, 200);
const scheduleQuarterIndicators = debounce(updateQuarterIndicators, 300);

// ---------------------------------------------------------------------------
// the s2 layer — read precomputed detections for the viewport, falling back
// to whatever is already in the CRDT (local-worker / synced detections)
// ---------------------------------------------------------------------------

// archive builds serve precomputed clusters, so the local-worker detect path —
// and the p2p mesh that shares its workload — only make sense where the archive
// doesn't serve: reveal Detect / peer status outside coverage AND where a
// covered viewport is blank for the selected quarters (_s2Blank, set by
// updateQuarterIndicators — coverage boxes are tiny AOIs, so "covered" alone
// overreaches). a running detection pins them visible so the progress bar
// (which lives in #detect-area) stays on screen. no-op in pure detect builds,
// which always expose the controls.
let _s2Blank = false;
function updateS2Controls() {
    if (!ARCHIVE) return;
    const show = D.isDetecting() || (s2ArchiveReady() &&
        CTX.map.getZoom() >= MIN_DETECT_ZOOM && (_s2Blank || !isCovered(viewportBbox(CTX.map))));
    if (show) ensureDetect();   // outside coverage the detect/p2p path is live
    document.getElementById('detect-area')?.style.setProperty('display', show ? '' : 'none');
    // the panel is 63px taller with them up, which is what the worldmap's own
    // media rule reads (style.css)
    document.getElementById('main-panel').classList.toggle('detect-up', show);
}

async function refreshS2Archive() {
    updateS2Controls();
    if (!ARCHIVE || D.isDetecting()) return;
    if (!s2ArchiveReady() || CTX.map.getZoom() < MIN_ARCHIVE_ZOOM) { D.updateDetectionSource(); return; }
    const range = CTX.quarters.range();
    if (!range) { D.updateDetectionSource(); return; }
    try {
        const clusters = await queryS2Archive(viewportBbox(CTX.map), range.startDate, range.endDate);
        if (D.isDetecting()) return;
        const qKeys = CTX.quarters.keys();
        // negated, so a cluster the table gives no intensity for passes rather
        // than vanishing: the shared flares schema has no site-level b12, and
        // `undefined >= 0.85` is false for every row — the floor would empty
        // the map with nothing in the console, the 2026-07-31 failure again
        const features = clusters.filter(c => !(c.avg_b12 < MODE.s2.floor)).map(c => archiveFeature(c, qKeys));
        if (!features.length) { D.updateDetectionSource(); return; }
        setDetections(features);
        // every feature above was just rebuilt for the ticked quarters. an open card
        // holds a COPY of the old feature's numbers, taken when it was clicked, so
        // without this it keeps showing the previous selection's persistence and
        // looks. re-open it from the rebuilt feature carrying the same id, as the
        // vnf and plume paths do after their own re-reads.
        reselectCurrentFeature();
    } catch (err) {
        console.error('S2 archive query error:', err);
        // a read that cannot name its object fails here and nowhere the reader
        // can see, so say it on the panel as well as in the console
        CTX.quarters.hint('Flare archive unavailable');
        D.updateDetectionSource();
    }
}

const scheduleS2Refresh = debounce(refreshS2Archive, 200);

// refresh the whole s2 view. in archive builds the archive overlay owns the
// detections source, so a plain updateDetectionSource() (CRDT only) would wipe
// it — route through the archive path, which falls back to the CRDT where the
// archive is empty. used by the sync-debounce caller.
const refreshS2View = () => ARCHIVE ? refreshS2Archive() : D.updateDetectionSource();

// detect.js render callback: re-draw the s2 view after CRDT/worker updates
const renderDetections = () => refreshS2View();

// initS2Archive memoizes, so this only awaits the warm-up fired at page parse
// before drawing the first viewport
function ensureS2Archive() {
    if (!ARCHIVE) return;
    initS2Archive(ARCHIVE)
        .then(() => { refreshS2Archive(); updateQuarterIndicators(); })
        .catch(err => console.error('S2 archive init error:', err));
}

// ---------------------------------------------------------------------------
// methane — plume detections for the ticked window, every provider at once
// ---------------------------------------------------------------------------

// the datadesk-only deploy (dist.sh local mode, behind cloudflare access). it
// bakes a plumes parquet carrying ghgsat and is the only place mapstand licence
// acreage — licensed data — is drawn. firedamp also took localhost as private;
// in the merged tree web/data is burnoff's symlink and holds no plumes parquet,
// so that clause only emptied the methane layer for anyone running `make serve`.
const PRIVATE = !!document.querySelector('meta[name="private"]');
const PLUMES = PRIVATE ? 'data/plumes.parquet' : null;
initPlumes(PRIVATE);
// attributions live on the store too (ch4id `sync push` exports the contract)
const ATTRIBUTIONS = `${ARCHIVE}/data-desk/attributions/data.parquet`;

let _plumeEpoch = 0;
async function refreshPlumes() {
    const range = CTX.quarters.range();
    if (!range) return;
    const e = ++_plumeEpoch;
    try {
        const rows = await readPlumes(range.startDate, range.endDate);
        if (e !== _plumeEpoch) return;
        setSource('plumes', CTX.fc(rows).features);
        // a plume's numbers do not move with the window, but an open flare card's
        // do, and this path runs on the same quarter change as the flaring one
        reselectCurrentFeature();
    } catch (err) { console.error('plume query error:', err); }
}

const schedulePlumeRefresh = debounce(refreshPlumes, 200);

// ---------------------------------------------------------------------------
// quarter availability indicators
// ---------------------------------------------------------------------------

// mark each quarter dot: 'detected' (local-worker s2, already processed) or
// 'dd-unavailable' (no layer here holds data for it). each family answers for
// itself and a null answer means it cannot say — not ready, or below its own
// zoom floor — so a family that cannot say never greys a dot.
//
// where the local detector is the way forward nothing greys at all, hint kept:
// a quarter the archive has nothing for is exactly the one to process, and
// greying it makes it unclickable. that is the same test the Detect button
// reads — outside coverage, or covered and blank for the ticked quarters.
async function updateQuarterIndicators() {
    const q = CTX.quarters, btns = [...q.buttons()], zoom = CTX.map.getZoom();
    const bbox = viewportBbox(CTX.map), pad = padBbox(bbox);
    const covered = !!ARCHIVE && isCovered(bbox);
    const ask = (ready, fn) => ready
        ? fn().catch(err => (console.error('quarter availability error:', err), null)) : null;
    // the floor each layer actually draws from: the archive scan is in memory,
    // so gating it at the detect floor left z4–z11 with clusters on the map and
    // a dot grid that greyed nothing and never set _s2Blank
    const [s2Avail, vnfAvail] = await Promise.all([
        ask(covered && s2ArchiveReady() && zoom >= MIN_ARCHIVE_ZOOM, () => availableQuartersS2(pad)),
        ask(vnfReady() && zoom >= MIN_VNF_ZOOM, () => availableQuartersVNF(pad, GRID_START, GRID_END)),
    ]);
    const active = b => b.classList.contains('dd-active');

    // a quarter greys only when NO layer covers it, so every family that can
    // answer is unioned before it reaches the dots
    const flareAvail = s2Avail && vnfAvail ? new Set([...s2Avail, ...vnfAvail]) : s2Avail ?? vnfAvail;
    const avail = flareAvail
        && new Set([...flareAvail, ...await availableQuartersPlumes(pad, GRID_START, GRID_END)]);
    // every selected quarter is unavailable here -> the map is blank; say why
    q.hint(!!avail && !btns.some(b => active(b) && avail.has(q.key(b)))
        ? 'No data for the selected quarters here' : '');

    _s2Blank = !!s2Avail && !btns.some(b => active(b) && s2Avail.has(q.key(b)));
    const detectable = zoom >= MIN_DETECT_ZOOM && (!covered || _s2Blank);
    btns.forEach(b => b.classList.toggle('dd-unavailable',
        !detectable && !!avail && !avail.has(q.key(b))));
    const done = detectable ? D.getDetectedQuarters() : new Set();
    btns.forEach(b => b.classList.toggle('detected', done.has(q.key(b))));
    if (detectable) D.updateDetectButton(done);
    updateS2Controls();
}

// ---------------------------------------------------------------------------
// the key
// ---------------------------------------------------------------------------

// four groups. one ramp runs through the first three, so each states its own
// units: b12 reflectance, radiant heat and kg/h are not comparable quantities
// and the colours do not mean the same numbers. the two flaring groups are the
// two instruments, side by side, which is the comparison the old S2|VNF toggle
// asked the reader to hold in their head.
//
// every row is a band rather than a layer toggle, as methane's already were:
// active rows OR into the data filter, cartograph runs those preds over every
// source it filters, and turning a group's rows all off takes that family off
// the map — the visibility control the toggle used to be. each band says what
// it is about, because a flare band is no statement about a plume.
const flareSection = (label, kind, cfg) => ({
    label,
    rows: flareBands(cfg).map(([band, color, inBand]) => ({
        swatch: { mark: 'flare', color }, label: band,
        pred: p => p.kind !== kind || inBand(p),
    })),
});

const keySections = () => [
    flareSection(`Flaring, S2 (${MODE.s2.unit})`, 'flare', MODE.s2),
    flareSection(`Flaring, VNF (${MODE.vnf.unit})`, 'vnf', MODE.vnf),
    {
        label: 'Methane (t/hr)',
        rows: PLUME_BANDS.map(([label, lo, hi, color]) => ({
            swatch: { mark: 'quantitative', color }, label,
            pred: p => !isPlume(p) || (lo == null ? p.rate_kg_h == null
                : p.rate_kg_h != null && p.rate_kg_h >= lo && (!hi || p.rate_kg_h < hi)),
        })),
    },
    {
        label: 'Infrastructure',
        rows: [
            { swatch: { mark: 'triangle', color: DD.white }, label: 'LNG',
              toggle: ['lng-terminal-dots', 'lng-terminal-hitarea'] },
            // layer toggle, not a data filter: licence areas aren't plumes
            ...(PRIVATE ? [{ swatch: { ring: AREA.licence }, label: 'Licence areas (MapStand)',
                             toggle: LICENCE_LAYERS }] : []),
        ],
    },
];

// ---------------------------------------------------------------------------
// deep links
// ---------------------------------------------------------------------------

// #site=<id> names a flare in either family: ask data-desk/flares, then
// eog/flares, and answer from whichever table owns the identifier. the two
// spaces are disjoint — base36-like against numeric-as-VARCHAR — but that
// is an accident of two producers and not a contract, so this reads both
// rather than dispatching on the shape of the id. #vnf= is an alias of the
// same resolver because burnoff wrote it for s2 sites too: those links have
// been dead since they were sent, and this is what repairs them.
async function resolveSite(id) {
    await whenReady;
    const cluster = await queryS2Flare(id).catch(() => null);
    if (cluster) return archiveFeature(cluster, CTX.quarters.keys());

    await ensureVNF();
    const range = CTX.quarters.range();
    if (!vnfReady() || !range) return null;
    const fc = await queryVNFFlare(id, range.startDate, range.endDate);
    // floor 0, not MODE.vnf.floor: the floor is a browsing threshold, and a
    // link that names one flare has already chosen it. under the 3 MW default
    // every dim flare — most onshore gas plants — resolved to nothing at all.
    return enrichVNFFeatures(fc.features.slice(0, 1), 0)[0] ?? null;
}

// #plume=<id>, off the loaded features where they hold it — matched on the
// canonical spelling, so a link written before the archive namespaced the ids
// still lands — and otherwise off a read of its own
async function resolvePlume(id) {
    await whenReady;
    return CTX.sources.plumes?.features.find(f => canon(f.properties.id) === canon(id))
        ?? await readPlume(id);
}

// ---------------------------------------------------------------------------
// "also here" — what the other layers hold at an open card's place
// ---------------------------------------------------------------------------

// the row is served from collections this session already holds, never a read:
// the plume read covers the whole world for the ticked window, the s2 cluster
// table is resident whole, and vnf is whatever its own layer read for this
// viewport — counted in looks, because a look is what vnf measures a night in.
function nearS2(lat, lon) {
    const rows = residentFlares(), range = CTX.quarters.range();
    if (!rows || !range) return [];
    // a box wide enough to hold the row's own radius test at this latitude,
    // cheap enough to run over the whole table on every card open
    const dLat = degLat(RADIUS_M), dLon = degLon(RADIUS_M, lat);
    const qKeys = CTX.quarters.keys();
    return rows
        .filter(c => Math.abs(c.lat - lat) <= dLat && Math.abs(c.lon - lon) <= dLon
            && c.last_seen >= range.startDate && c.first_seen <= range.endDate
            && !(c.avg_b12 < MODE.s2.floor))
        .map(c => archiveFeature(c, qKeys));
}

// count only what the map is drawing. an entry the key has filtered out would
// offer a card the next refresh cannot find, and every refresh path ends in
// reselectCurrentFeature — which closes a card it cannot find. a family whose
// bands are all off is a family with nothing drawn, so its group empties itself
// and nearby.js drops it.
const drawn = fs => (fs ?? []).filter(f => CTX.preds.every(p => p(f.properties)));

const nearbyGroups = (lat, lon) => [
    { kind: 'plume', one: 'methane plume', many: 'methane plumes',
      features: drawn(CTX.sources.plumes?.features) },
    { kind: 'flare', one: 'flare site', many: 'flare sites',
      features: drawn(nearS2(lat, lon)) },
    { kind: 'vnf', one: 'VNF look', many: 'VNF looks',
      features: drawn(CTX.sources.vnf?.features),
      count: fs => fs.reduce((n, f) => n + (f.properties.detection_count || 0), 0) },
];

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------

mount({
    title: 'Flux',
    subtitle: 'Emissions explorer',
    search: true,
    map: { center: [52.8720, 25.1676], zoom: 12, minZoom: 1.5, maxZoom: 18 },
    about: `
        <div class="region-row">
            <div><div class="dd-secondary">Regions covered:</div><div>Data Desk archive</div></div>
            <svg id="modal-worldmap"></svg>
        </div>
        <p>Flux maps two ways the oil and gas industry puts carbon into the air &mdash; gas it burns, and gas it leaks &mdash; on one map, under one date window. It is made by <a href="https://datadesk.eco">Data Desk</a> for researchers, journalists and anyone else watching the industry.</p>
        <p>Flaring is measured two ways at once, a layer each. <em>S2</em> is Sentinel-2, which sees a flare by day in shortwave infrared: those detections come from the Data Desk archive, and where the archive has no coverage <em>Detect</em> processes Sentinel-2 imagery for the current view in your own browser, sharing the work &mdash; and syncing the results &mdash; with connected peers over <a href="https://en.wikipedia.org/wiki/WebRTC">WebRTC</a>. <em>VNF</em> is <a href="https://eogdata.mines.edu/products/vnf/global_gas_flare.html" target="_blank">VIIRS Nightfire</a>, which sees flares at night and measures their radiant heat. The two scales are not comparable, so the key states each one's units; switch either off there.</p>
        <p>Methane plumes are dated observations from Carbon Mapper, IMEO, SRON and Data Desk, each carrying a measured release rate. Shape says whether a feature burned or leaked; colour says only how much. Pick quarters to set the window for everything on the map, and click any feature for the data behind it.</p>
        <div class="methods">
            <div class="methods-head" id="methods-toggle"><span class="dd-chevron dd-chevron-down"></span><span class="dd-secondary">Methods &amp; data</span></div>
            <div class="methods-list dd-secondary hidden" id="methods-list">
                <p>Faruolo et al. (2024) <a href="https://doi.org/10.1088/1748-9326/ad82fb" target="_blank">The DAFI v2 algorithm for gas flare detection</a></p>
                <p>Elvidge et al. (2013) <a href="https://doi.org/10.3390/rs5094423" target="_blank">VIIRS Nightfire: Satellite pyrometry at night</a></p>
                <p>Jacob et al. (2022) <a href="https://doi.org/10.5194/acp-22-9617-2022" target="_blank">Quantifying methane emissions from the global scale down to point sources</a></p>
                <p>Global Energy Monitor <a href="https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/" target="_blank">Global Gas Infrastructure Tracker</a></p>
                <p>Design by <a href="https://mikaeldahlen.com/" target="_blank">Mikael Dahlén</a></p>
            </div>
        </div>`,

    // duckdb reads by name: the attributions table (methane/attribution.js) and,
    // in the private build, the baked plumes parquet
    data: {
        files: { ...(PRIVATE ? { plumes: PLUMES } : {}), attributions: ATTRIBUTIONS },
        prefetch: PRIVATE ? ['plumes'] : [],
    },

    // the three detection sources are dynamic — the viewport handlers own two of
    // them and the quarter grid re-reads the third; terminals are static geojson
    sources: async ctx => {
        CTX = ctx;
        // before the layers are added, not in ready() after them: an id a layer
        // names outright is fetched too late by styleimagemissing, and maplibre
        // has already logged it as unloadable. the reads below cover the fetch.
        MARKS.forEach(id => ensureMark(ctx.map, id));
        // added here, not in ready(), so the key's visibility toggle has a layer
        // to read — and so licence acreage sits beneath every marking
        if (PRIVATE) addLicenceLayers(ctx.map, ctx.sql);
        const range = ctx.quarters.range();
        const [terminals, plumes] = await Promise.all([
            fetch('terminals.geojson').then(r => r.json()),
            range ? readPlumes(range.startDate, range.endDate)
                .catch(err => (console.error('plume query error:', err), [])) : [],
        ]);
        terminals.features = terminals.features.filter(f => f.properties.type === 'export');
        setTerminals(terminals.features);
        return {
            detections: { type: 'FeatureCollection', features: [] },
            vnf: { type: 'FeatureCollection', features: [] },
            // clusters only when far out — points take over from z5 (~UK-sized viewport)
            plumes: { data: ctx.fc(plumes), cluster: true, clusterMaxZoom: 4, clusterRadius: 30,
                      clusterProperties: { rate_sum: ['+', ['coalesce', ['get', 'rate_kg_h'], 0]] } },
            'lng-terminals': terminals,
        };
    },

    layers: [
        {
            // flare markings stepped through the intensity ramp; the persistence
            // slider gates display-only via this layer filter. an unrated s2
            // site passes it (1) and an unrated vnf one does not (0) — see
            // persistenceFilter, where the two null branches are stated
            id: 'detections', type: 'symbol', source: 'detections',
            filter: persistenceFilter(0.25, 1),
            layout: { ...PIN, 'icon-image': flareIcon(MODE.s2) },
        },
        {
            // the same marking on radiant heat. it draws above the s2 layer so
            // that the card's imagery, which goes in under 'detections', stays
            // under both
            id: 'vnf', type: 'symbol', source: 'vnf',
            filter: persistenceFilter(0.25, 0),
            layout: { ...PIN, 'icon-image': flareIcon(MODE.vnf) },
        },
        {
            // methane plumes: the quantitative marking through the same ramp, on
            // rate. provider is not a colour any more — colour means how much,
            // everywhere on this map, and shape says burned or leaked.
            id: 'plumes', type: 'symbol', source: 'plumes',
            filter: ['!', ['has', 'point_count']],
            hover: p => `<span class="dd-title">${rateT(p) ? `${rateT(p)} t/hr` : 'rate n/a'}</span><br>`
                + `${escapeHtml(label(p.provider))}${p.date ? ' · ' + escapeHtml(formatDate(p.date)) : ''}`,
            layout: {
                ...PIN, ...RATE_LABEL,
                'icon-image': plumeIcon,
                // rate-less plumes get no label; colliding ones drop, icons stay
                'text-field': ['case', ['==', ['typeof', ['get', 'rate_kg_h']], 'number'], ['concat',
                    ['number-format', ['/', ['get', 'rate_kg_h'], 1000], { 'max-fraction-digits': 1 }], ' t/hr'], ''],
                'text-optional': true,
            },
            paint: { 'text-color': DD.white },
        },
        {
            // a cluster total is a sum of rates, not a rate, so it stays off the
            // ramp at the default white
            id: 'plumes-clusters', type: 'symbol', source: 'plumes',
            filter: ['has', 'point_count'],
            layout: {
                ...PIN, ...RATE_LABEL,
                'icon-image': `quantitative-${DD.white}`,
                // round before formatting: maplibre drops a 0 'max-fraction-digits'
                'text-field': ['concat',
                    ['number-format', ['round', ['/', ['get', 'rate_sum'], 1000]], {}], ' t/hr'],
                // a cluster is what the reader clicks through, so its total is
                // never dropped for a collision
                'text-allow-overlap': true,
            },
            paint: { 'text-color': DD.white },
        },
        {
            // lng terminal triangles with a generous hit area
            id: 'lng-terminal-hitarea', type: 'circle', source: 'lng-terminals',
            hover: p => `<span class="dd-title">${p.name}</span><br>${p.country} · ${p.type}<br>`
                + (p.capacity_mtpa ? `${p.capacity_mtpa} mtpa` : '—'),
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 12, 6, 16, 12, 22],
                'circle-color': 'transparent',
                'circle-opacity': 0,
            },
        },
        {
            id: 'lng-terminal-dots', type: 'symbol', source: 'lng-terminals',
            layout: {
                ...PIN, 'icon-image': MARK.lng,
                // an installation, not a measurement: smaller than the detections
                'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 6, 0.65, 12, 0.9],
            },
        },
    ],

    // one window over all three detection layers: both flaring layers re-query
    // for it, methane re-reads its own date predicate
    quarters: {
        onChange: () => {
            D.updateDetectButton();
            scheduleS2Refresh();
            scheduleVNFRefresh();
            schedulePlumeRefresh();
            // the availability hint is about the ticked window, so it goes stale
            // the moment a dot is ticked — the map does not have to move first
            scheduleQuarterIndicators();
            // re-filter the open card to the new window (the async re-query reconciles the map)
            refreshCard();
        },
    },

    // the one slider left. intensity is the key's business now — it has two
    // scales to state and a slider can only carry one
    sliders: [
        {
            key: 'persistence', label: 'Minimum persistence',
            min: 0, max: 1, step: 0.05, value: 0.25, format: v => `${Math.round(v * 100)}%`,
            onInput: v => { PERSISTENCE_MIN = v; applyPersistenceFilter(); },
        },
    ],

    key: keySections,

    // the drawer, dragged open from the right edge. plume rows are the live
    // source, so they follow the ticked window and the key's bands; the
    // attributions table is its own read of the contract ch4id publishes, and
    // its rows are not plume properties, so it sits out the filter pipeline.
    table: [
        {
            label: 'Plumes',
            rows: ({ sources }) => sources.plumes.features.map(f => f.properties),
            cols: ['id', 'provider', 'date', 'rate_kg_h', 'satellite', 'sector', 'lat', 'lon'],
        },
        {
            label: 'Attributions', filter: false,
            rows: async ({ read }) => (await read('attributions',
                { columns: ['id', 'source_label', 'source_kind', 'operator', 'confidence', 'lat', 'lon'] }))
                .sort((a, b) => String(a.source_label).localeCompare(String(b.source_label))),
            cols: ['id', 'source_label', 'source_kind', 'operator', 'confidence', 'lat', 'lon'],
        },
    ],

    detail: {
        layers: ['detections', 'vnf', 'plumes'],
        // two keys are written — #site= for a flare of either family, #plume=
        // for a plume — and #vnf= is read as a legacy spelling of #site=.
        // config order is read order, so a hash carrying both takes #site=.
        hashKeys: { site: resolveSite, vnf: resolveSite, plume: resolvePlume },
        hashKey: p => isPlume(p) ? 'plume' : 'site',
        idProp: 'id',
        // no minZoom: below the threshold a selection is carried by its own shape
        // marking, and the highlight box waits for imagery that resolves the
        // point of interest (pdf:74, 79)
        flyZoom: 15, highlightZoom: 10,
        // one header, one body per kind — card/index.js holds the registry
        title: cardTitle,
        html: cardHtml,
        onShow: onCardShow,
        onClose: onCardClose,
    },

    ready: ctx => {
        // the detect controls, at the panel foot: the button (or its progress
        // bar, which replaces it) and the peers count beside it, on one row. the
        // count used to sit by the mode toggle; there is no mode toggle now, and
        // it was only ever about this one workload anyway
        document.getElementById('main-panel').insertAdjacentHTML('beforeend', `
            <div class="detect-area" id="detect-area">
                <button id="detect-btn" class="dd-btn">Detect</button>
                <div id="detect-progress" class="detect-progress hidden">
                    <span id="detect-text">Searching...</span>
                    <div class="detect-bar" id="detect-bar"></div>
                </div>
                <div id="peer-status"><span class="dd-secondary">Peers</span> <span id="peer-count">0</span></div>
            </div>`);

        initCard({ map: ctx.map, hasArchive: !!ARCHIVE, archive: ARCHIVE,
                   quarterKeys: () => ctx.quarters.keys() });
        initNearby(ctx.map, nearbyGroups);
        initProbabilityOverlay(ctx.map);
        addCandidateLayers(ctx.map, ctx.sql);

        // intro modal extras: archive coverage worldmap (pdf:86) + methods reveal
        boxesWorldmap(document.getElementById('modal-worldmap'), async () => {
            if (!ARCHIVE) return null;
            await whenCovered();
            return coverageTiles()?.features.map(featureBbox);
        }, 0.06);
        document.getElementById('methods-toggle').addEventListener('click', function () {
            this.querySelector('.dd-chevron').classList.toggle('dd-chevron-down');
            document.getElementById('methods-list').classList.toggle('hidden');
        });

        ctx.map.on('moveend', () => {
            scheduleQuarterIndicators();
            D.updateDetectButton();
            scheduleS2Refresh();
            scheduleVNFRefresh();
        });

        // archive builds start with the detect/p2p controls hidden until the
        // viewport leaves coverage; pure-detect builds load the CRDT up front
        if (ARCHIVE) updateS2Controls(); else ensureDetect();

        // first draw. both flaring layers read the same viewport and window from
        // here on; the archive kick memoizes the warm-up fired at page parse
        ensureS2Archive();
        refreshVNF();
        readyResolve();
    },
});
