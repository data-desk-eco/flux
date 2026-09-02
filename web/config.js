// flux — one map, one date window, three detection layers. this config is the
// whole app declaration: shell/app.js mounts it, and everything it names lives
// in the hook modules — layers.js (marking, ramp and colour policy for every
// layer), card/ (one header and a body per feature kind), nearby.js (the "also
// here" row), flaring/ (render.js instrument tables, s2archive.js and vnf.js
// readers, clustering.js feature builders) and methane/ (plumes.js reader,
// attribution.js, candidates.js, licences.js, overlay.js and sweep.js).
//
// flaring is measured two ways and both are drawn at once, a layer each — s2
// (sentinel-2 archive clusters) and vnf (viirs nightfire) — because the two
// instruments answer the same question from day and from night, and a toggle
// made the reader hold one answer in their head to compare it with the other.
// methane plumes are the third layer. the quarter dot grid drives all three: one
// window, and a quarter greys only when no layer covers it.
//
// what a toggle used to do the key does, per layer: each family's rows are its
// colour bands, so turning them all off takes that family off the map. that is
// also where the intensity gate went, which is what pays for the second layer
// in panel space.
//
// everything here reads: flux publishes nothing and computes no detection of its
// own. the in-browser sentinel-2 detector and the peer mesh that shared its work
// were removed on 2026-08-17 — the archive covers what they scanned, and a
// viewer that also ran a methodology had two of everything to keep in step.

import { mount } from './shell/app.js';
import { viewportBbox, boxesWorldmap, ensureMark } from './shell/map.js';
import { canon, padBbox, featureBbox, escapeHtml, formatDate, degLat, degLon } from './shell/util.js';
import { MODE } from './flaring/render.js';
import { DD, AREA, MARKS, PIN, RATE_LABEL, PLUME_BANDS, flareBands, flareIcon, plumeIcon } from './layers.js';
import { initArchive, objects } from './shell/archive.js';
import { prefetchData } from './shell/data.js';
import { initVNF, resetVNF, queryVNF, queryVNFFlare, availableQuartersVNF, isReady as vnfReady } from './flaring/vnf.js';
import { initS2Archive, queryS2Archive, queryS2Flare, availableQuartersS2, coverageTiles, whenCovered, residentFlares } from './flaring/s2archive.js';
import { initCard, cardTitle, cardHtml, onCardShow, onCardClose, refreshCard, reselectCurrentFeature } from './card/index.js';
import { initNearby, RADIUS_M } from './nearby.js';
import { setTerminals, archiveFeature, enrichVNFFeatures } from './flaring/clustering.js';
import { initPlumes, isPlume, label, readPlumes, availableQuartersPlumes, readPlume } from './methane/plumes.js';
import { addCandidateLayers } from './methane/candidates.js';
import { LICENCE_LAYERS, addLicenceLayers } from './methane/licences.js';
import { initProbabilityOverlay } from './methane/overlay.js';

// legacy deep links: #vnf/123 -> #vnf=123 (the shell's hash params), which the
// site resolver then reads whichever family the id belongs to
if (/^#vnf\/[^/=&]+$/.test(location.hash))
    history.replaceState(null, '', location.hash.replace('/', '='));

// ---------------------------------------------------------------------------
// build config (index.html meta tags)
// ---------------------------------------------------------------------------

// every layer reads the data desk archive (CloudFerro, public-read, remote range
// requests): vnf the eog tables, s2 the data-desk ones, methane one detections
// object per provider. no module names an object — index.json says which object
// each table is and whether it is partitioned, so a table that starts
// partitioning does not break a reader. read here at page parse, overlapping
// maplibre init. the tag is not optional and this does not pretend otherwise:
// with the detector gone there is no build that draws anything without it.
const ARCHIVE = document.querySelector('meta[name="data-bucket"]').content;
initArchive(ARCHIVE);

// the datadesk-only deploy (dist.sh local mode, behind cloudflare access). it
// bakes a plumes parquet carrying ghgsat and is the only place mapstand licence
// acreage — licensed data — is drawn. the meta tag is the whole test: taking
// localhost as private too, as firedamp did, only emptied the methane layer for
// anyone running `make serve`, because web/data holds no plumes parquet here.
const PRIVATE = !!document.querySelector('meta[name="private"]');
// attributions live on the store too (ch4id `sync push` exports the contract)
const ATTRIBUTIONS = `${ARCHIVE}/data-desk/attributions/data.parquet`;

// pull every small object this map reads whole, in parallel, at page parse —
// overlapping the engine download instead of queueing statements behind it.
// prefetchData holds an 8 MB cap, so data-desk/detections (60 MB, plumes and
// the per-date flare series in one table) stays on the ranged tier, and a
// table that grows past the cap demotes itself rather than breaking. the
// private build reads its own baked plumes, so the public detections objects
// are not fetched for it.
for (const t of ['flares', ...(PRIVATE ? [] : ['detections'])])
    objects(t).then(us => us.forEach(prefetchData)).catch(() => {});
prefetchData(ATTRIBUTIONS);

initS2Archive(ARCHIVE);

const MIN_ARCHIVE_ZOOM = 4;   // displaying precomputed archive clusters (cheap, in-memory)
const MIN_VNF_ZOOM = 6;       // 20k+ dim sites would drown the archive clusters at world scale
                              // (and when the prefetch falls back, a viewport is a remote read)

// date span the quarter grid covers (last 4 calendar years) — bounds the vnf
// availability query so it stays cheap
const GRID_START = `${new Date().getFullYear() - 3}-01-01`;
const GRID_END = `${new Date().getFullYear()}-12-31`;

// the persistence gate is display-only (a layer filter, no re-cluster). the
// intensity gate that used to sit beside it is now MODE[x].floor, a constant:
// with both families drawn there is no one scale for one slider to carry, and
// the key's colour bands filter above the floor on each family's own units.
let PERSISTENCE_MIN = 0.25;

let CTX;                                    // the shell's ctx (set in sources)
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
// the shell applies them when a key row is toggled, not when the data changes.
// keeping ctx.sources in step matters twice over — it is what the shell re-sets
// from on the next toggle, and what detail's allFeatures() resolves against.
function setSource(id, features) {
    const all = CTX.sources[id] = { type: 'FeatureCollection', features };
    CTX.map.getSource(id)?.setData(CTX.preds.length
        ? { ...all, features: features.filter(f => CTX.preds.every(p => p(f.properties))) } : all);
    // the table drawer re-renders on this and on moveend; a window change moves
    // the data without moving the camera, so it has to be said
    dispatchEvent(new Event('fx-filters'));
}
const setDetections = features => setSource('detections', features);
const setVNF = features => setSource('vnf', features);

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
// the s2 layer — precomputed archive clusters for the viewport
// ---------------------------------------------------------------------------

// the whole flares table is resident after one read (s2archive.js), so this is a
// filter over memory rather than a request, and the vnf shape above is the one
// it follows: one window, one viewport, then reconcile the open card.
async function refreshS2Archive() {
    if (CTX.map.getZoom() < MIN_ARCHIVE_ZOOM) { setDetections([]); return; }
    const range = CTX.quarters.range();
    if (!range) return;
    try {
        const clusters = await queryS2Archive(viewportBbox(CTX.map), range.startDate, range.endDate);
        const qKeys = CTX.quarters.keys();
        // negated, so a cluster the table gives no intensity for passes rather
        // than vanishing: the shared flares schema has no site-level b12, and
        // `undefined >= 0.85` is false for every row — the floor would empty
        // the map with nothing in the console, the 2026-07-31 failure again
        setDetections(clusters
            .filter(c => !(c.avg_b12 < MODE.s2.floor))
            .map(c => archiveFeature(c, qKeys)));
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
        setDetections([]);
    }
}

const scheduleS2Refresh = debounce(refreshS2Archive, 200);

// ---------------------------------------------------------------------------
// methane — plume detections for the ticked window, every provider at once
// ---------------------------------------------------------------------------

// the private build's baked plumes parquet (see PRIVATE, defined with the
// build config above)
const PLUMES = PRIVATE ? 'data/plumes.parquet' : null;
initPlumes(PRIVATE);

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
    } catch (err) {
        console.error('plume query error:', err);
        // the same courtesy the two flaring layers pay: an empty map with
        // nothing said is indistinguishable from a place with no plumes
        CTX.quarters.hint('Plume read failed');
    }
}

const schedulePlumeRefresh = debounce(refreshPlumes, 200);

// ---------------------------------------------------------------------------
// quarter availability indicators
// ---------------------------------------------------------------------------

// grey a quarter dot ('dd-unavailable') when no layer here holds data for it.
// each family answers for itself and a null answer means it cannot say — below
// its own zoom floor, or not read yet — so a family that cannot say never greys
// a dot, and a dot nothing can speak for stays clickable.
async function updateQuarterIndicators() {
    const q = CTX.quarters, btns = [...q.buttons()], zoom = CTX.map.getZoom();
    const pad = padBbox(viewportBbox(CTX.map));
    const ask = (ready, fn) => ready
        ? fn().catch(err => (console.error('quarter availability error:', err), null)) : null;
    // each layer answers from the floor it actually draws at: the flares table
    // is resident in memory, so asking it at the vnf floor would leave z4–z6
    // with clusters on the map and a dot grid that greyed them
    const [s2Avail, vnfAvail] = await Promise.all([
        ask(zoom >= MIN_ARCHIVE_ZOOM, () => availableQuartersS2(pad)),
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
    btns.forEach(b => b.classList.toggle('dd-unavailable', !!avail && !avail.has(q.key(b))));
}

// ---------------------------------------------------------------------------
// the key
// ---------------------------------------------------------------------------

// four groups, each stating its own units: b12 reflectance, radiant heat and
// t/hr are not comparable quantities, and the two ramps behind them (layers.js)
// do not mean the same numbers. the two flaring groups are the two instruments,
// side by side, which is the comparison the old S2|VNF toggle asked the reader
// to hold in their head.
//
// every row is a band rather than a layer toggle, as methane's already were:
// active rows OR into the data filter, the shell runs those preds over every
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
    flareSection(`S2 flaring (${MODE.s2.unit})`, 'flare', MODE.s2),
    flareSection(`VNF flaring (${MODE.vnf.unit})`, 'vnf', MODE.vnf),
    {
        // no row for a plume the provider put no rate on: it is drawn (in grey,
        // off the ramp — layers.js), but it belongs to no band, so narrowing to
        // one leaves it out as any other rate outside the band would be
        label: 'Methane (t/hr)',
        rows: PLUME_BANDS.map(([label, lo, hi, color]) => ({
            swatch: { mark: 'quantitative', color }, label,
            // the null test is not decoration: `null >= 0` is true in js, and
            // without it every unrated plume would join the bottom band
            pred: p => !isPlume(p)
                || (p.rate_kg_h != null && p.rate_kg_h >= lo && (!hi || p.rate_kg_h < hi)),
        })),
    },
    // no infrastructure group, because there is no infrastructure layer: the
    // candidate markings belong to an open plume card and are drawn only around
    // the source the reader picked (candidates.js), so there is nothing for a
    // key row to toggle. the terminals are still read, for the names they give
    // S2 sites — a standing layer of them only competed with the measurements.
    ...(PRIVATE ? [{
        label: 'Acreage',
        // layer toggle, not a data filter: licence areas aren't plumes
        rows: [{ swatch: { ring: AREA.licence }, label: 'Licence areas (MapStand)',
                 toggle: LICENCE_LAYERS }],
    }] : []),
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
    // the map is published while its two flaring families are still being
    // reconciled, and the tag says so wherever the title is read
    badge: 'Beta',
    search: true,
    map: { center: [52.8720, 25.1676], zoom: 12, minZoom: 1.5, maxZoom: 18 },
    // the intro states what this build covers and where the numbers come from.
    // it carries no prose about the map: the key names every layer in its own
    // units and the cards carry the method, so a paragraph restating them is one
    // more place to go stale.
    about: `
        <div class="region-row">
            <div><div class="dd-secondary">Regions covered:</div><div>Data Desk archive</div></div>
            <svg id="modal-worldmap"></svg>
        </div>
        <div class="methods">
            <div class="dd-secondary">Methods &amp; data</div>
            <div class="methods-list dd-secondary">
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

    // the three detection sources are dynamic — the viewport handlers own two
    // of them and the quarter grid re-reads the third. the terminals are read
    // for their names alone (clustering.js says "Near <terminal>"): they are
    // not a layer, so nothing here draws them
    sources: async ctx => {
        CTX = ctx;
        // before the layers are added, not in ready() after them: an id a layer
        // names outright is fetched too late by styleimagemissing, and maplibre
        // has already logged it as unloadable. the reads below cover the fetch.
        MARKS.forEach(id => ensureMark(ctx.map, id));
        // added here, not in ready(), so the key's visibility toggle has a layer
        // to read — and so licence acreage sits beneath every marking
        if (PRIVATE) addLicenceLayers(ctx.map, ctx.sql);
        const terminals = await fetch('terminals.geojson').then(r => r.json());
        terminals.features = terminals.features.filter(f => f.properties.type === 'export');
        setTerminals(terminals.features);
        // all three sources start empty and ready() fires their first reads:
        // holding the mount here for the plume read held the layers — and so
        // the first flare dot, already resident by then — behind it
        return {
            detections: { type: 'FeatureCollection', features: [] },
            vnf: { type: 'FeatureCollection', features: [] },
            // clusters only when far out — points take over from z5 (~UK-sized viewport)
            // the cluster label is a plume count (point_count), so no aggregate
            // cluster property is needed. no summed rate: colour encodes rate, and
            // a summed t/hr would mash units with a nature-trace ppm·m cluster.
            plumes: { data: ctx.fc([]), cluster: true, clusterMaxZoom: 4, clusterRadius: 30 },
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
            // the same marking on radiant heat. it draws above the s2 layer, so
            // the card's heat footprint — which goes in under 'detections' —
            // stays under both families' markings
            id: 'vnf', type: 'symbol', source: 'vnf',
            filter: persistenceFilter(0.25, 0),
            layout: { ...PIN, 'icon-image': flareIcon(MODE.vnf) },
        },
        {
            // methane plumes: the quantitative marking on viridis, by rate.
            // colour is still how much — it is a ramp of its own because gas
            // released and gas burned are not one quantity — and shape is what
            // says which of the two this is. no value label: colour encodes how
            // much, so the number would repeat it at every point (and a ppm·m
            // alongside a t/hr is a unit mash). the detail card carries the value.
            id: 'plumes', type: 'symbol', source: 'plumes',
            filter: ['!', ['has', 'point_count']],
            hover: p => `${escapeHtml(label(p.provider))}${p.confidence ? ` · ${escapeHtml(p.confidence)}` : ''}${p.date ? ' · ' + escapeHtml(formatDate(p.date)) : ''}`,
            layout: {
                ...PIN,
                'icon-image': plumeIcon,
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
                // a cluster is a grouping, so its label is a count, not a value:
                // the colour of the point it groups still encodes the rate, and a
                // summed t/hr (or a ppm·m) would mash units and repeat the ramp.
                'text-field': ['to-string', ['get', 'point_count']],
                // a cluster is what the reader clicks through, so its total is
                // never dropped for a collision
                'text-allow-overlap': true,
            },
            paint: { 'text-color': DD.white },
        },
    ],

    // one window over all three detection layers: both flaring layers re-query
    // for it, methane re-reads its own date predicate
    quarters: {
        onChange: () => {
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

    // the drawer, dragged open from the right edge. one tab per family, in the
    // key's order, and each reads the live source — so a tab holds exactly the
    // rows its layer is drawing, for the ticked window and the bands left on.
    // clicking a row opens that feature's card, which is why the two flaring
    // families keep a tab each rather than sharing one: their intensity columns
    // are B12 reflectance and radiant heat, and those do not share a column any
    // more than they share a ramp.
    //
    // the attributions table is the exception. it is ch4id's contract, read
    // here on its own, and its rows are not feature properties — so it sits out
    // the filter pipeline that follows the map.
    table: [
        {
            label: 'Flares (S2)',
            rows: ({ sources }) => sources.detections.features.map(f => f.properties),
            cols: ['id', 'name', 'max_b12', 'detection_count', 'observations',
                   'persistence', 'lat', 'lon'],
        },
        {
            label: 'Flares (VNF)',
            rows: ({ sources }) => sources.vnf.features.map(f => f.properties),
            cols: ['id', 'name', 'country', 'max_rh', 'detection_count', 'observations',
                   'persistence', 'lat', 'lon'],
        },
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
        // a selection is always pickable — below the highlight zoom it is carried
        // by its own shape marking, and the box waits for imagery that resolves
        // the point of interest (pdf:74, 79)
        flyZoom: 15, highlightZoom: 10,
        // one header, one body per kind — card/index.js holds the registry
        title: cardTitle,
        html: cardHtml,
        onShow: onCardShow,
        onClose: onCardClose,
    },

    ready: ctx => {
        initCard({ map: ctx.map, archive: ARCHIVE, quarterKeys: () => ctx.quarters.keys() });
        initNearby(ctx.map, nearbyGroups);
        initProbabilityOverlay(ctx.map);
        addCandidateLayers(ctx.map, ctx.sql);

        // the intro modal's one live part: the archive's coverage, drawn as
        // boxes on a worldmap (pdf:86)
        boxesWorldmap(document.getElementById('modal-worldmap'),
            () => whenCovered().then(() => coverageTiles()?.features.map(featureBbox)), 0.06);

        ctx.map.on('moveend', () => {
            scheduleQuarterIndicators();
            scheduleS2Refresh();
            scheduleVNFRefresh();
        });

        // first draw, all three layers. their tables started downloading at
        // page parse (the prefetch block up top), so these mostly run against
        // buffers already resident. the quarter dots wait for the first plume
        // paint: the availability index is the one read here that still goes
        // to the network (data-desk/detections is past the prefetch cap), and
        // queued earlier it sat between the layers and their first points
        refreshS2Archive();
        refreshVNF();
        refreshPlumes().then(() => updateQuarterIndicators());
        readyResolve();
    },
});
