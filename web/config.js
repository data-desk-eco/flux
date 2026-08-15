// flux on cartograph — one map, one date window, three detection layers. this
// config plus the hook modules: layers.js (marking/ramp/colour policy for every
// layer), card/ (one header and a body per feature kind), nearby.js (the "also
// here" row), flaring/ (render.js mode tables, detect.js local detect+p2p,
// s2archive.js / vnf.js readers, clustering.js feature builders) and methane/
// (plumes.js reader, attribution.js, candidates.js, licences.js, overlay.js,
// sweep.js viewport sweep).
//
// flaring has two modes sharing one detection layer — s2 (archive clusters,
// detect fallback) and vnf (viirs nightfire) — and the S2|VNF toggle governs
// that layer alone. methane plumes are their own layer, always on. the quarter
// dot grid drives all three: one window, and a quarter greys only when no layer
// covers it.

import { mount } from './vendor/cartograph/app.js';
import { closeDetail } from './vendor/cartograph/detail.js';
import { viewportBbox, boxesWorldmap, ensureMark } from './vendor/cartograph/shell.js';
import { padBbox, featureBbox, getHashParam, escapeHtml, formatDate, degLat, degLon } from './vendor/cartograph/util.js';
import { MODE } from './flaring/render.js';
import { DD, RAMP, AREA, MARK, MARKS, PIN, RATE_LABEL, PLUME_BANDS, flareIcon, plumeIcon } from './layers.js';
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
// build config (index.html meta tags) + mode state ('s2' or 'vnf')
// ---------------------------------------------------------------------------

// both modes read the datadesk archive (CloudFerro, public-read, remote range
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

let mode = null;
const isVnf = () => mode === 'vnf';

// slider state. the avg-B12 / avg-RH intensity gate is the active quality gate;
// the persistence gate is display-only (a layer filter, no re-cluster)
const GATE = { s2: MODE.s2.filter.default, vnf: MODE.vnf.filter.default };
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
// the two null branches stay split, and the last arm is where they split. in s2
// a null is unrated: a rate gate cannot exclude a site whose rate we never
// measured without asserting one, so it passes. in vnf a null is a finding — no
// clear night — and the flare is dropped.
//
// s2 held 0 here for a while, on the argument that scoring the unmeasured high
// lets a glint field through a 25% gate looking like a finding. the archive no
// longer has that shape: sql/tables/flares.checks.sql refuses to publish a table
// rating fewer than half its sites, and today 68 of 9603 rows are unrated, 29 of
// them past the intensity gate. what the 0 cost instead was every ras laffan
// site — the complex this repo keeps a monitoring doc for — with the quarter
// grid still lit, because availability counts detections and those quarters have
// them. blank map, controls saying otherwise, nothing in the console.
const persistenceFilter = v =>
    ['>=', ['coalesce', ['get', 'rank'], ['get', 'persistence'], isVnf() ? 0 : 1], v];
const applyPersistenceFilter = () =>
    CTX.map.setFilter('detections', persistenceFilter(PERSISTENCE_MIN));

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

// programmatic mode switch routed through the toggle so the ui stays in sync
const setMode = m => document.querySelector(`.cg-filter[data-key="mode"] [data-value="${m}"]`)?.click();

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
            minAvgB12: () => GATE.s2,
            minZoom: MIN_DETECT_ZOOM,
        });
        return m.ensureDetect();
    })
    .catch(err => { _detect = null; console.error('detect init error:', err); });

// ---------------------------------------------------------------------------
// vnf mode
// ---------------------------------------------------------------------------

let _vnfInitStarted = false, _vnfRaw = null;

async function refreshVNF() {
    if (!isVnf() || !vnfReady()) return;
    if (CTX.map.getZoom() < MIN_VNF_ZOOM) { _vnfRaw = null; setDetections([]); return; }
    const range = CTX.quarters.range();
    if (!range) return;
    try {
        const fc = await queryVNF(viewportBbox(CTX.map), range.startDate, range.endDate);
        _vnfRaw = fc.features;
        // an open card holds the previous window's aggregates, so reconcile it
        // against the re-query the way the slider path does — otherwise a card
        // keeps a persistence for quarters that are no longer selected, and the
        // '—' a window with no clear night should show never appears
        if (isVnf()) { updateVNFSource(); reselectCurrentFeature(); }
    } catch (err) { console.error('VNF query error:', err); }
}

const scheduleVNFRefresh = debounce(refreshVNF, 200);
const scheduleQuarterIndicators = debounce(updateQuarterIndicators, 300);
const updateVNFSource = () => { if (_vnfRaw) setDetections(enrichVNFFeatures(_vnfRaw, GATE.vnf)); };

// ---------------------------------------------------------------------------
// s2 archive mode — read precomputed detections for the viewport, falling back
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
    const show = mode === 's2' && flaringOn() && (D.isDetecting() || (s2ArchiveReady() &&
        CTX.map.getZoom() >= MIN_DETECT_ZOOM && (_s2Blank || !isCovered(viewportBbox(CTX.map)))));
    if (show) ensureDetect();   // outside coverage the detect/p2p path is live
    for (const sel of ['#peer-status', '#detect-area'])
        document.querySelector(sel)?.style.setProperty('display', show ? '' : 'none');
}

async function refreshS2Archive() {
    updateS2Controls();
    if (mode !== 's2' || !ARCHIVE || D.isDetecting()) return;
    if (!s2ArchiveReady() || CTX.map.getZoom() < MIN_ARCHIVE_ZOOM) { D.updateDetectionSource(); return; }
    const range = CTX.quarters.range();
    if (!range) { D.updateDetectionSource(); return; }
    try {
        const clusters = await queryS2Archive(viewportBbox(CTX.map), range.startDate, range.endDate);
        if (mode !== 's2' || D.isDetecting()) return;
        const qKeys = CTX.quarters.keys();
        // negated, so a cluster the table gives no intensity for passes rather
        // than vanishing: the shared flares schema has no site-level b12, and
        // `undefined >= 0.85` is false for every row — the slider would empty
        // the map with nothing in the console, the 2026-07-31 failure again
        const features = clusters.filter(c => !(c.avg_b12 < GATE.s2)).map(c => archiveFeature(c, qKeys));
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
// archive is empty. used by the sync-debounce and slider callers.
const refreshS2View = () => ARCHIVE ? refreshS2Archive() : D.updateDetectionSource();

// detect.js render callback: re-draw the s2 view after CRDT/worker updates
const renderDetections = () => { if (mode === 's2') refreshS2View(); };

// kick the archive when entering s2 mode; initS2Archive memoizes, so this only
// awaits the warm-up fired at page parse before refreshing the viewport
function ensureS2Archive() {
    if (!ARCHIVE) return;
    initS2Archive(ARCHIVE)
        .then(() => { if (mode === 's2') { refreshS2Archive(); updateQuarterIndicators(); } })
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
// 'dd-unavailable' (archive/vnf, no data in this viewport). a null `avail`
// means the data source isn't ready / zoomed-out — leave everything enabled.
// uncovered s2 viewports fall through to the detect branch (same coverage test
// that reveals the Detect button) so quarters stay selectable for the fallback —
// as do covered-but-blank ones (hint kept), where the archive holds nothing for
// the selected quarters and the local detect fallback is the only way forward.
async function updateQuarterIndicators() {
    const q = CTX.quarters, btns = [...q.buttons()];
    const bbox = viewportBbox(CTX.map), pad = padBbox(bbox);

    if (isVnf() || (ARCHIVE && isCovered(bbox))) {
        btns.forEach(b => b.classList.remove('detected'));
        const ready = isVnf() ? vnfReady() : s2ArchiveReady();
        // the floor each mode actually draws from: the archive scan is in memory,
        // so gating it at the detect floor left z4–z11 with clusters on the map
        // and a dot grid that greyed nothing and never set _s2Blank
        const zoomOk = CTX.map.getZoom() >= (isVnf() ? MIN_VNF_ZOOM : MIN_ARCHIVE_ZOOM);
        let flareAvail = null;
        if (ready && zoomOk) {
            try {
                flareAvail = isVnf()
                    ? await availableQuartersVNF(pad, GRID_START, GRID_END)
                    : await availableQuartersS2(pad);
            } catch (err) { console.error('quarter availability error:', err); }
        }
        // a quarter greys only when NO layer covers it, so the flaring answer is
        // unioned with methane's before it reaches the dots. the detect controls
        // still read flaring's alone: the local detector is the s2 fallback, and
        // a quarter only methane covers is not one it can process.
        const avail = flareAvail
            && new Set([...flareAvail, ...await availableQuartersPlumes(pad, GRID_START, GRID_END)]);
        const active = b => b.classList.contains('dd-active');
        btns.forEach(b => b.classList.toggle('dd-unavailable', !!avail && !avail.has(q.key(b))));
        // every selected quarter is unavailable here -> the map is blank; say why
        q.hint(!!avail && !btns.some(b => active(b) && avail.has(q.key(b)))
            ? 'No data for the selected quarters here' : '');
        _s2Blank = !isVnf() && !!flareAvail && !btns.some(b => active(b) && flareAvail.has(q.key(b)));
        if (!_s2Blank) { updateS2Controls(); return; }
    } else { _s2Blank = false; q.hint(''); }

    btns.forEach(b => b.classList.remove('dd-unavailable'));
    const done = D.getDetectedQuarters();
    btns.forEach(b => b.classList.toggle('detected', done.has(q.key(b))));
    D.updateDetectButton(done);
    updateS2Controls();
}

// ---------------------------------------------------------------------------
// mode switching
// ---------------------------------------------------------------------------

// the merged key, in three groups. one ramp runs through the first two, so each
// group states its own units: b12 reflectance, radiant heat and kg/h are not
// comparable quantities and the colours do not mean the same numbers.
const keySections = cfg => [
    {
        // the ramp rows are also the family switch: each carries the detections
        // layer, so clicking any one takes flaring off the map and greys all
        // three together. what governs flaring alone — the two sliders and the
        // S2|VNF toggle — goes with it (syncFlaring).
        label: `Flaring — ${cfg.label}`,
        rows: [...cfg.stops].reverse().map((v, i) => ({
            swatch: { mark: 'flare', color: RAMP[2 - i] }, label: i === 0 ? `${v}+` : String(v),
            toggle: 'detections' })),
    },
    {
        // a multi-select band filter rather than a third slider: two sliders is
        // the panel budget. active rows OR into the data filter, and cartograph
        // runs those preds over every source it filters — so each band says what
        // it is about, because a rate band is no statement about a flare site.
        label: 'Methane — t/hr',
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

// flaring's visibility is the family switch, so everything that governs flaring
// alone follows it: the two sliders leave the panel rather than sit there dead,
// and the S2|VNF toggle takes the inactive grey and stops answering. neither
// value is touched, so both come back as they were. methane keeps drawing.
const flaringOn = () => !!CTX.map.getLayer('detections')
    && CTX.map.getLayoutProperty('detections', 'visibility') !== 'none';

function syncFlaring() {
    const on = flaringOn();
    for (const k of ['intensity', 'persistence']) CTX.sliders[k].show(on);
    CTX.filters.mode.unavailable(() => !on);
    updateS2Controls();
}

function switchMode(m) {
    if (m === mode) return;
    mode = m;
    const cfg = MODE[m];

    // the subtitle is not touched: it names the application, and a mode is one
    // toggle over one of its three layers, not a change of subject
    document.getElementById('main-panel').classList.toggle('mode-s2', m === 's2');
    closeDetail();
    CTX.setKey(keySections(cfg));

    // retune the intensity slider for the mode
    const { min, max, step } = cfg.filter;
    CTX.sliders.intensity.set({ min, max, step, value: GATE[m], format: cfg.formatFilter });

    updateQuarterIndicators();

    if (m === 'vnf') {
        setDetections([]);   // clear s2 features so they don't linger during load
        if (!_vnfInitStarted) {
            _vnfInitStarted = true;
            initVNF().then(() => {
                if (isVnf()) { refreshVNF(); updateQuarterIndicators(); }
            }).catch(err => {
                console.error('VNF init error:', err);
                _vnfInitStarted = false;
                resetVNF();
                setMode('s2');
            });
        } else if (vnfReady()) refreshVNF();
    } else {
        D.updateDetectionSource();
        ensureS2Archive();
    }

    updateS2Controls();
    CTX.map.setLayoutProperty('detections', 'icon-image', flareIcon(cfg));
    applyPersistenceFilter();   // the null branch is mode-dependent
}

// ---------------------------------------------------------------------------
// sliders + deep links
// ---------------------------------------------------------------------------

let _sliderTimer;
function debouncedRecluster() {
    clearTimeout(_sliderTimer);
    _sliderTimer = setTimeout(() => {
        if (isVnf()) updateVNFSource(); else refreshS2View();
        reselectCurrentFeature();
    }, 80);
}

// #site=<id> names a flare in either family: ask data-desk/flares, then
// eog/flares, and take the mode of whichever table owns the identifier. the
// two spaces are disjoint — base36-like against numeric-as-VARCHAR — but that
// is an accident of two producers and not a contract, so this reads both
// rather than dispatching on the shape of the id. #vnf= is an alias of the
// same resolver because burnoff wrote it for s2 sites too: those links have
// been dead since they were sent, and this is what repairs them.
async function resolveSite(id) {
    await whenReady;
    const cluster = await queryS2Flare(id).catch(() => null);
    if (cluster) { setMode('s2'); return archiveFeature(cluster, CTX.quarters.keys()); }

    setMode('vnf');
    const deadline = Date.now() + 15000;
    while (!vnfReady() && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    const range = CTX.quarters.range();
    if (!vnfReady() || !range) return null;
    const fc = await queryVNFFlare(id, range.startDate, range.endDate);
    // gate 0, not GATE.vnf: the intensity slider is a browsing filter, and a
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
// the plume read covers the whole world for the ticked window, and the s2
// cluster table is resident whole. vnf is the one family that would cost a
// bounding-box read per card open, so it appears only while its own layer is up
// and its viewport features are in the source — and it is counted in looks,
// because a look is what vnf measures a night in.
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
            && !(c.avg_b12 < GATE.s2))
        .map(c => archiveFeature(c, qKeys));
}

// count only what the map is drawing. an entry the key or a slider has filtered
// out would offer a card the next refresh cannot find, and every refresh path
// ends in reselectCurrentFeature — which closes a card it cannot find.
const drawn = fs => (fs ?? []).filter(f => CTX.preds.every(p => p(f.properties)));

// flaring off means the map is not drawing it, so the row does not offer it:
// every entry has to open a card the next refresh can find again
const nearbyGroups = (lat, lon) => [
    { kind: 'plume', one: 'methane plume', many: 'methane plumes',
      features: drawn(CTX.sources.plumes?.features) },
    ...(!flaringOn() ? [] : [
        // a flare card opened from a vnf map needs its own mode back, and
        // switching is what puts the site in the source reselectCurrentFeature reads
        { kind: 'flare', one: 'flare site', many: 'flare sites',
          features: drawn(nearS2(lat, lon)), before: () => setMode('s2') },
        ...(isVnf() ? [{ kind: 'vnf', one: 'VNF look', many: 'VNF looks',
          features: drawn(CTX.sources.detections?.features),
          count: fs => fs.reduce((n, f) => n + (f.properties.detection_count || 0), 0) }] : []),
    ]),
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
        <p>Flaring is detected two ways. Sentinel-2 detections come from the Data Desk archive; where the archive has no coverage, <em>Detect</em> processes Sentinel-2 imagery for the current view in your own browser, sharing the work &mdash; and syncing the results &mdash; with connected peers over <a href="https://en.wikipedia.org/wiki/WebRTC">WebRTC</a>. <em>VNF</em> switches to <a href="https://eogdata.mines.edu/products/vnf/global_gas_flare.html" target="_blank">VIIRS Nightfire</a>, which sees flares at night and measures their radiant heat.</p>
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

    // detections and plumes are both dynamic — the mode/viewport handlers own
    // one and the quarter grid re-reads the other; terminals are static geojson
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
            // clusters only when far out — points take over from z5 (~UK-sized viewport)
            plumes: { data: ctx.fc(plumes), cluster: true, clusterMaxZoom: 4, clusterRadius: 30,
                      clusterProperties: { rate_sum: ['+', ['coalesce', ['get', 'rate_kg_h'], 0]] } },
            'lng-terminals': terminals,
        };
    },

    layers: [
        {
            // flare markings stepped through the intensity ramp; the persistence
            // slider gates display-only via this layer filter
            id: 'detections', type: 'symbol', source: 'detections',
            filter: persistenceFilter(0.25),
            layout: { ...PIN, 'icon-image': flareIcon(MODE.s2) },
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

    filters: [{
        key: 'mode', value: 's2',
        options: [{ value: 's2', label: 'S2' }, { value: 'vnf', label: 'VNF' }],
        onChange: switchMode,
    }],

    // one window over all three detection layers: flaring re-queries in whichever
    // mode is up, methane re-reads its own date predicate
    quarters: {
        onChange: () => {
            if (isVnf()) scheduleVNFRefresh();
            else { D.updateDetectButton(); scheduleS2Refresh(); }
            schedulePlumeRefresh();
            // the availability hint is about the ticked window, so it goes stale
            // the moment a dot is ticked — the map does not have to move first
            scheduleQuarterIndicators();
            // re-filter the open card to the new window (the async re-query reconciles the map)
            refreshCard();
        },
    },

    sliders: [
        {
            key: 'intensity', label: 'Minimum intensity',
            min: MODE.s2.filter.min, max: MODE.s2.filter.max, step: MODE.s2.filter.step,
            value: MODE.s2.filter.default, format: MODE.s2.formatFilter,
            onInput: v => { GATE[isVnf() ? 'vnf' : 's2'] = v; debouncedRecluster(); },
        },
        {
            key: 'persistence', label: 'Minimum persistence',
            min: 0, max: 1, step: 0.05, value: 0.25, format: v => `${Math.round(v * 100)}%`,
            onInput: v => { PERSISTENCE_MIN = v; applyPersistenceFilter(); },
        },
    ],

    key: () => keySections(MODE.s2),

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
        layers: ['detections', 'plumes'],
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
        // s2-only controls: peers indicator beside the mode toggle, detect
        // button + progress at the panel foot
        document.querySelector('.cg-filter[data-key="mode"]').insertAdjacentHTML('beforeend',
            '<div id="peer-status"><span class="dd-secondary">Peers Connected:</span> <span id="peer-count">0</span></div>');
        document.getElementById('main-panel').insertAdjacentHTML('beforeend', `
            <div class="detect-area s2-only" id="detect-area">
                <button id="detect-btn" class="dd-btn">Detect</button>
                <div id="detect-progress" class="detect-progress hidden">
                    <span id="detect-text">Searching...</span>
                    <div class="detect-bar" id="detect-bar"></div>
                </div>
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
            if (isVnf()) scheduleVNFRefresh();
            else { D.updateDetectButton(); scheduleS2Refresh(); }
        });

        // the key owns flaring's visibility; this listener runs after
        // cartograph's, which has already set it, and follows it with the
        // controls that only mean something while flaring is drawn
        document.getElementById('key-panel').addEventListener('click', syncFlaring);
        syncFlaring();

        // archive builds start with the detect/p2p controls hidden until the
        // viewport leaves coverage; pure-detect builds load the CRDT up front
        if (ARCHIVE) updateS2Controls(); else ensureDetect();
        // start in s2 mode unless a flare deep link is resolving — the resolver
        // adopts the mode of the table that owns the id, so leave it to say
        if (!['site', 'vnf'].some(k => getHashParam(location.hash, k))) setMode('s2');
        readyResolve();
    },
});
