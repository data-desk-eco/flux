# Merging burnoff + firedamp: architecture brief

Sources mapped: `/Users/louis/Tools/burnoff` and `/Users/louis/Tools/firedamp`, at the
state of their respective `main` branches. Vendor internals are summarised only as
far as the two apps consume them.

## 0. The shared foundation

Both apps vendor **byte-identical** copies of `web/vendor/cartograph/` (11 files),
`web/vendor/dd/`, `web/vendor/maplibre-gl.*`, `web/vendor/fonts/` and
`web/vendor/duckdb/` — verified by `diff` on every file. One shared `web/vendor/`
in the merged repo is safe today. Firedamp additionally has
`vendor/dd/markings/*.svg` and `vendor/duckdb/duckdb-browser.mjs` checked out
where burnoff's are absent; these are untracked artifacts of a partial
`vendor.sh` run, not a real divergence.

### cartograph config API, exactly as these two consume it

`mount(config)` — `vendor/cartograph/app.js:67`. Top-level keys either app sets:
`title, subtitle, badge, about, search, map, data, sources, layers, filters,
quarters, sliders, key, table, detail, ready`. (`link`, `story` unused by both.)
`compileConfig` (`util.js:97`) upgrades declarative string forms to functions;
both apps pass functions already, so it is a no-op for them.

**Load order inside `mount`** (`app.js:67-119`): `compileConfig` →
`buildShell(config)` → `createMap({hash:'map', ...config.map})` → `wireWorldmap` /
`wireCollapse` / `wireSearch` → `initData(config.data)` → build `ctx` →
`initQuarters` → `wireSliders` → **await `style.load`** → `addSatellite` →
`await config.sources(ctx)` → `addSource`/`addLayer` (+ `hoverPopup` per layer
`hover`) → `initKey` + `wireFilters` + `await config.key(ctx)` → `initDetail` →
`initTable` → **`await config.ready(ctx)`** → `restorePermalink()` →
`window.cartograph = ctx`.

**The `ctx` object** (`app.js:80`): `{map, config, read, meta, sql, fc, sources}`,
plus `ctx.quarters` (`app.js:81`), `ctx.sliders` (`ui.js:97`), `ctx.setKey`
(`app.js:106`), and `ctx.preds` — the live predicate array (`app.js:43`).

**Filters / key / sliders conventions.** `config.filters[]` =
`{key, label, value, options:[{value,label}], pred(value)→predicate|null,
onChange(value, ctx)}`. `config.key` is `ctx => sections` where sections are
`[{label, rows:[{swatch, label, toggle, pred}]}]`; `swatch` is
`{mark,color,size}` | `{ring}` | `{dot}` | `{line}` (`ui.js:109-120`). A row with
`toggle` flips maplibre layer visibility; a row with `pred` joins a per-section
OR multi-select. All active preds **AND** together and every geojson source is
re-`setData` to the matching subset (`app.js:40-51`), so clustered sources
re-cluster — then `dispatchEvent(new Event('cg-filters'))` re-renders the table.
`config.sliders[]` = `{key,label,min,max,step,value,format,onInput(v,ctx)}`;
`ctx.sliders[key].set({min,max,step,value,format})` retunes at runtime.

**Quarter dot grid.** `config.quarters = {onChange(ctx), years=4}`; `initQuarters`
(`quarters.js:8`) builds a Q1–Q4 × year dot grid into `#quarters`, keys are
`"2025_3"`, API `{buttons, key, keys, range, hint}`. Callers grey dots by adding
`dd-unavailable`.

**Hash permalinks.** Three independent writers coexist in one hash: maplibre's own
`#map=` (`app.js:72`), `#step=` (story, unused by both), and detail's
`#<hashKey>=<id>` — `getHashParam`/`setHashParam` (`util.js:119-128`) split on `&`
and `history.replaceState`. Resolver flow (`detail.js:122-142`): read hash → find
in `allFeatures()` → else `await cfg.resolve(id)` → `showDetail(f, true)` →
`flyTo(flyZoom ?? 15)` → on `moveend` regroup overlapping features within 10 px.
Because internal selection uses `replaceState`, `hashchange` only fires for
external navigation (`detail.js:194`).

**Data.** `initData({files, prefetch, base})` boots DuckDB-WASM eagerly;
`read(name,{columns,where})`, `meta`, `sql`, `fc`, `parquetInput`. The DuckDB
worker and wasm resolve from `new URL('../duckdb/', import.meta.url)`
(`data.js:3`) — vendor-relative, so it survives any app relocation.

**Archive.** `initArchive(base)` fetches `<base>/index.json` once (module
singleton `base, doc`, `archive.js:18`); `objects(table,{key,provider})` returns
exact URLs.

---

## 1. burnoff

### `web/index.html` (24 lines)

Five stylesheets (`vendor/fonts/inter.css`, `vendor/maplibre-gl.css`,
`vendor/dd/map.css`, `vendor/cartograph/shell.css`, `style.css`), then a classic
`<script src="vendor/maplibre-gl.js">` (a global `maplibregl`, which `shell.js:16`
depends on) and `<script type="module" src="config.js">`. Two meta config tags:
`signaling-url` = `wss://burnoff-signaling.louis-6bf.workers.dev` (`:6`) and
`data-bucket` = the CloudFerro archive (`:11`). An empty `data-bucket` yields a
pure client-side detect build.

### `web/config.js` (482 lines)

This is the mode state machine as much as a config. Non-`mount` top matter:
legacy `#vnf/123 → #vnf=123` rewrite (`:20`), `ARCHIVE` from meta +
`initArchive`/`initS2Archive` at parse (`:33-34`), `MIN_ARCHIVE_ZOOM=4` /
`MIN_VNF_ZOOM=6` (`:36-37`), `GRID_START`/`GRID_END` (`:41-42`), `mode` ∈
`s2|vnf`, `GATE={s2,vnf}` + `PERSISTENCE_MIN` slider state (`:50-51`),
`CTX`/`whenReady` (`:53-55`), `persistenceFilter` (`:72`).

`mount` keys set: `title, subtitle, map, about, sources, layers, filters,
quarters, sliders, key, detail, ready` — **no `search`, no `data`, no `table`**.

- `sources` (`:341`) captures `CTX`, fetches `terminals.geojson`, filters to
  `type === 'export'`, and returns an **empty** `detections` FC (mode handlers own
  its data thereafter) plus `lng-terminals`.
- `layers` (`:352`): `detections` (symbol, `markIconExpr`, `ICON_SIZE`,
  `filter: persistenceFilter(0.25)`), `lng-terminal-hitarea` (invisible fat circle
  carrying `hover`), `lng-terminal-dots` (triangle).
- `filters` is a single `mode` toggle whose `onChange` is `switchMode` (`:245`) —
  the app's central dispatcher: retitles the subtitle, toggles `.mode-s2`,
  `closeDetail()`, `CTX.setKey(keySections(cfg))`, retunes the intensity slider,
  swaps `icon-image`.
- `sliders`: `intensity` (mode-dependent range, debounced re-cluster) and
  `persistence` (0–1, pure layer filter).
- `key: () => keySections(MODE.s2)` (`:419`), rebuilt on every mode switch.
- `detail` (`:421`): `hashKey:'vnf'`, `idProp:'id'`, `flyZoom:15`,
  **`minZoom:10`**, `resolve: resolveFlare`.
- `ready` (`:432`) injects two DOM fragments cartograph does not own
  (`#peer-status` into the mode filter group, `#detect-area` into `#main-panel`),
  calls `initDetect`/`initCard`, preloads ramp markings, draws the coverage
  worldmap into the intro modal, and wires `moveend`.

### Import graph

`config.js` → `render.js`, `vnf.js`, `s2archive.js`, `detect.js`, `card.js`,
`clustering.js` + five vendor modules.
`card.js` → `s2/cog.js`, `s2/geo.js`, `render.js`, `clustering.js` (for
`DEG_TO_RAD`), `vnf.js`, `s2archive.js`, vendor `detail.js`/`shell.js`/`util.js`.
`vnf.js` → `clustering.js` (`sumQuarters`), vendor `data.js`/`archive.js`/`util.js`.
`s2archive.js` → vendor only.
`detect.js` → `s2/cluster.js`, `clustering.js`, vendor `shell.js`; and **lazily**
`import('./crdt.js' | './store.js' | './rtc.js' | './sync.js')` inside
`ensureDetect` (`detect.js:69-70`), so a pure-archive session never fetches the
P2P stack.
`detect-worker.js` (module worker) → `s2/stac.js`, `s2/cog.js`, `s2/geo.js`,
`s2/wasm/s2e_wasm.js`, plus a dynamic `import('./s2/vendor/geotiff-esm.js')`
(`:91`).
`sync.js` → `crdt.js`; `s2/cluster.js` → `s2/score.js`; `s2/cog.js` →
`s2/vendor/geotiff-esm.js`, `s2/geo.js`.

### Module roles and exports

| Module | Role | Exports |
|---|---|---|
| `render.js` | mode lookup tables, ramp, icon expression | `DD, RAMP, RH_TO_MCM, MODE, scaleT, rampRGB, chartNorm, markIconExpr, ICON_SIZE, formatDate` |
| `card.js` | the detection detail card | `initCard, cardTitle, cardHtml, onCardShow, onCardClose, refreshCard, reselectCurrentFeature` |
| `clustering.js` | terminal grid + pure feature builders | `DEG_TO_RAD, setTerminals, findNearestTerminal, sumQuarters, archiveFeature, enrichVNFFeatures` |
| `vnf.js` | EOG VIIRS Nightfire reader | `isReady, initVNF, resetVNF, queryVNF, queryVNFFlare, fetchVNFDetections, availableQuartersVNF` |
| `s2archive.js` | Data Desk S2 reader + coverage test | `isReady, initS2Archive, isCovered, whenCovered, coverageTiles, queryS2Archive, availableQuartersS2, fetchS2Detections` |
| `detect.js` | local detect + P2P orchestration | `MIN_DETECT_ZOOM, initDetect, ensureDetect, isDetecting, updateDetectionSource, crossDateCluster, getDetectedQuarters, updateDetectButton` |
| `detect-worker.js` | module Web Worker: STAC → COG windows → wasm `detectBlock` | none |
| `crdt.js` | LWW-Map + binary codec | `LWWMap, encodeKey, decodeKey, encodeDetection, decodeDetection, encodeStringTable, decodeStringTable, encodeStateVector, decodeStateVector, encodeEntries, decodeEntries` |
| `store.js` | IndexedDB persistence (`burnoff-crdt`) | `Store` |
| `sync.js` | sync protocol + awareness | `SyncManager, validateDetection, isAllowedCogUrl` |
| `rtc.js` | WebRTC mesh, region-aware peer selection | `geohash3, jaccardScore, PeerMesh` |
| `s2/cluster.js` | spatial clustering | `isSeasonal, clusterDetections` |
| `s2/cog.js` | COG windowed reads + block tiling | `BLOCK_SIZE, BLOCK_OVERLAP, openCOG, readWindow, enumerateBlocks` |
| `s2/geo.js` | UTM ↔ WGS84 | `wgs84ToUtm, utmToWgs84, utmParams, metersToDegreesLat, metersToDegreesLon` |
| `s2/score.js` | SWIR flare-quality scoring | scoring constants + `glintAngleNadir, glintScoreFromAngle, glintScoreFromElevation, ratioScore, persistenceScore, glintPenalty, glintSuspect, scoreCluster` |
| `s2/stac.js` | STAC search | `searchSTAC` (async generator) |

### Data reads

Two tiers per mode, both through the cartograph DuckDB layer.

*VNF*: `objects('flares', {provider:'eog'})` → one site row each, with a nested
`quarters` list windowed in JS by `sumQuarters` (`vnf.js:60-96`) because
cartograph's `where` only spans scalar columns. The daily series is read per-card
from `objects('detections', {provider:'eog', key: cell})` — the H3 cell rides on
the feature, so no bucket listing and no H3 library (`vnf.js:133`).

*S2*: `objects('flares', {provider:'data-desk'})` read **whole, once**, held in
memory (`s2archive.js:73`) and filtered per viewport in JS; per-card series from
`objects('detections', {provider:'data-desk', key: cell})` with `kind='flare'` in
the predicate (`s2archive.js:110`). `data-desk/coverage.geojson` is a named asset
fetched directly (`s2archive.js:61`), driving both `isCovered` and the
intro-modal worldmap.

### Card structure, and the flare vs VNF body split

`cardTitle` (`:83`) prefers a nearby LNG terminal name. `cardHtml` (`:90`) emits
`.info-stats` (four rows), `#intensity-chart`, `.events` header + `#events-list`,
and — **only when `!isVnf()`** — the `Open Image` / `Download CSV` button pair
(`:130-134`). The split runs deeper than the buttons:

- `fetchDetections` switches reader (`:64`)
- `l1c-only` row dimming applies only when `!vnf && !hasArchive` (`:180`)
- keyboard nav skips `.l1c-only` in s2 (`:38`)
- `selectDetection` routes to `showHeatFootprint` for VNF vs
  `loadImageryForDetection` for S2 (`:307-308`)
- `downloadFlareCSV` refuses in VNF (`:455`)

Both branches share `clearCogLayers` and `dimSatellite`.

### `web/style.css` (58 lines)

Adds only: mode-row flex + `#peer-status`, `.s2-only` gating, detect
button/progress/bar, `.dd-dot-btn.detected`, card internals (`.info-stats`,
`.intensity-chart`, `.events*`, `.event-item` states), intro-modal extras
(`.region-row`, `.methods*`), and a mobile rule hiding chart + actions.

---

## 2. firedamp

### `web/index.html` (19 lines)

Same five stylesheets, same two scripts, one meta tag — `data-bucket`. No
signaling meta.

### `web/config.js` (259 lines)

Nearly the whole app. Top matter: `PRIVATE` gate (`:17`, `localhost` OR
`<meta name="private">`), `bucket` from meta, `initArchive(bucket)` at parse
(`:23`), `PLUMES`/`ATTRIBUTIONS` (`:24-27`), editorial
`COLOR`/`LABEL`/`SRCS`/`PRIVATE_SRCS`/`SECTOR` maps (`:32-38`),
`PLUME_COLS`/`PLUME_WHERE` projection (`:41-45`), `ICON` size ramp (`:49`),
`sourceUrl`/`overlayUrl` (`:54-66`), and the `canon`/`resolve` id-normaliser that
lets pre-namespace permalinks still resolve (`:75-76`).

`mount` keys set: `title, badge, subtitle, about, search:true, map, data, sources,
layers, filters, key, table, detail, ready` — **no `quarters`, no `sliders`**.

- `sources` (`:105`) adds licence layers when private, then either reads the baked
  local parquet or fans `objects('detections')` out through `Promise.allSettled`
  so one missing provider costs only its own rows; joins the attribution key set
  onto `p.attr`; returns one clustered source (`clusterMaxZoom:4`,
  `clusterRadius:30`, `clusterProperties.rate_sum`).
- `layers` (`:131`): one symbol layer per styled provider plus a white catch-all
  for providers nobody has coloured yet, then `plumes-clusters`.
- `filters`: `attr` and `date`.
- `key` (`:191`): rate-band rows (pure `pred` multi-select), source rows (also
  `pred`, so clusters re-form), and — private only — a `toggle` row for
  `LICENCE_LAYERS`.
- `table`: `Detections` (feature properties) and `Attributions`
  (`filter:false`, its own `read`).
- `detail` (`:235`): `hashKey:'plume'`, `flyZoom:15`, no `minZoom`, `resolve`,
  `onShow` → `enrich(p)` + `showProbabilityOverlay`, `onClose` →
  `clearSelection()` + `clearProbabilityOverlay()`.
- `ready` (`:258`) is one line.

### Import graph

`config.js` → `attribution.js`, `candidates.js`, `licences.js`, `overlay.js` +
vendor `app.js`/`archive.js`/`util.js`/`dd/palette.js`.
`attribution.js` → `candidates.js` (`selectPlume`) + vendor `data.js`/`util.js`.
`candidates.js` → vendor `shell.js`/`archive.js`/`util.js`/`dd/palette.js`.
`licences.js` → vendor `shell.js`/`util.js`/`dd/palette.js`.
`overlay.js` → **nothing** (fully standalone).
No workers, no wasm, no dynamic imports.

### Module roles and exports

| Module | Role | Exports |
|---|---|---|
| `attribution.js` | bulk attribution lookup + open-meteo wind | `loadAttributions, enrich` |
| `candidates.js` | provider-owned `infrastructure` candidates: viewport sweep + per-plume radius query, waypoint markings over an invisible fat hit layer | `selectPlume, clearSelection, addCandidateLayers` |
| `licences.js` | MapStand licence acreage from a baked Hilbert GeoParquet, private only | `LICENCE_LAYERS, addLicenceLayers` |
| `overlay.js` | georeferenced MARS-S2L probability PNG, alpha remapped `64→0` | `initProbabilityOverlay, clearProbabilityOverlay, showProbabilityOverlay` |

### The plume card path

`detail.html` (`config.js:239`) is a *sync skeleton*: `.fd-badges`, a 2×2
`.fd-stats` grid whose wind cell is a `…` placeholder, and `.fd-analysis` with
`#analysis` = `Loading…`. `onShow` fires `enrich(p)`, which races two async fills
against a monotonic `requestId` guard (`attribution.js:10, 102-106`):

1. `fetchWind` → `renderWind` writes into `#stat-wind`
2. `loadAttributions().get(p.id)` → `recordHtml` writes into `#analysis`, then
   `selectPlume` runs a candidate radius query (10 km for coarse sensors, else 3 km)

Attributed OSM labels link to osm.org; anything else becomes a `data-fly` link
handled by a document-level delegate in `candidates.js:149`.

### Data reads

Public: `objects('detections')` per provider + `attributions/data.parquet` from
the store. Private: one baked `data/plumes.parquet`. `candidates.js` and
`licences.js` bypass `read()` entirely and hand raw SQL to `ctx.sql`
(`candidates.js:31`, `licences.js:36`), which is why `licences.js:11` must build
an **absolute** URL via `document.baseURI`.

### `web/style.css` (14 lines)

Adds only `.fd-badges`, `.fd-stats`, `.fd-stat-big`, `.fd-wind`, `.fd-analysis`,
`.fd-attrib`, `.fd-para`, `.fd-evidence a`.

---

## 3. Duplicated constants and helpers

| Thing | Copies |
|---|---|
| `ICON_SIZE` / `ICON` — *identical* expression `['interpolate',['linear'],['zoom'],2,0.55,10,0.8,14,1]` | `burnoff/web/render.js:89`, `firedamp/web/config.js:49` |
| `fastDistM` — identical body | `burnoff/web/clustering.js:25`, `burnoff/web/s2/cluster.js:13` |
| `DEG_TO_RAD` / `R_EARTH` | `clustering.js:9-10` (exported), `s2/cluster.js:3-4` (private) |
| Metres→degrees `111320` | `card.js:333-334`, `clustering.js:38`, `s2/geo.js:110` |
| Metres→degrees `111` (coarser constant, same job) | `firedamp/web/candidates.js:90` |
| Padded-rect viewport sweep: `swept` memo, `0.3` pad, epoch counter | `firedamp/web/candidates.js:66-82`, `firedamp/web/licences.js:22-50` (near-verbatim) |
| SQL string-literal escaper | `candidates.js:25` (`literal`), vendor `data.js:32` (`quote`) |
| Debounce-timer idiom | `burnoff/web/config.js:104, 106, 163, 289` (four separate timers) |
| Entire vendor tree | two byte-identical copies |

Also worth fixing on the way through: firedamp passes `{cache:true}` to `read()`
at `config.js:228`, but `data.js:67` accepts only `{columns, where}`. A dead
option — harmless, but it reads as if caching were configured.

---

## 4. Deploy

**burnoff** → GitHub Pages at `http://research.datadesk.eco/burnoff/`.
`.github/workflows/deploy.yml` on push to `main`: `cp -r web/* dist/` (`:24`),
three vendor integrity assertions (`:25-27`), then one `find | xargs sed`
cache-bust stamping `${GITHUB_SHA::8}` onto app JS/HTML while **pruning
`dist/vendor` and `dist/s2/vendor`** and stripping any stamp back off `vendor/`
paths (`:44-52`) — because two URLs for one module means two module instances.
Then `upload-pages-artifact` → `deploy-pages`. Separately, `wrangler.toml`
deploys only the `burnoff-signaling` Worker + Durable Object (`make deploy`).
No `dist.sh`, no private variant.

**firedamp** → GitHub Pages at `http://research.datadesk.eco/firedamp/` **plus** a
private Cloudflare Pages project `firedamp-private.pages.dev` behind Cloudflare
Access. `make deploy` = `deploy-private` then `git push`. `deploy-private`
refuses to run unless the Access gate is confirmed live (`Makefile:17`), bakes
`web/data/plumes.parquet` (including GHGSat) and `web/data/licences.parquet`, then
runs `dist.sh <sha> local` + `wrangler pages deploy`. `scripts/dist.sh` does a
**selective flat copy** — `cp web/index.html web/style.css web/*.js dist/` —
injects `<meta name="private">` in local mode, and cache-busts with four targeted
`sed` passes that never match vendor paths.

Both `scripts/vendor.sh` shell out to `~/Tools/cartograph/scripts/vendor.sh
web/vendor`, which begins `rm -rf "$VENDOR"` and repopulates from
`~/Tools/cartograph/src/`, `~/Tools/design/dist/`, unpkg and a GitHub release.
burnoff's adds a copy of the s2e wasm into `web/s2/wasm/`.

---

## 5. Merge hazards

### Relocation breakage — ordered by how quietly it fails

1. **`new Worker('detect-worker.js', {type:'module'})`** (`burnoff/web/detect.js:413`)
   — a bare specifier resolved against the **document URL**, not `import.meta.url`.
   Moving burnoff to `web/flaring/` keeps this working only because the document
   moves too; it breaks the moment anything is served from a different depth.
   Should become `new URL('./detect-worker.js', import.meta.url)`. Note burnoff's
   CI cache-buster has a rule specifically matching `new Worker('…')`
   (`deploy.yml:50`) that a `new URL` form would no longer match.
2. **`fetch('terminals.geojson')`** (`burnoff/web/config.js:343`) — same
   document-relative assumption. `web/terminals.geojson` is a tracked file
   generated by `make terminals`.
3. **`document.baseURI` in `licences.js:11`** — builds an absolute parquet URL for
   raw SQL. Under `web/methane/` it resolves to `/methane/data/licences.parquet`,
   correct only if `dist.sh` is taught the new layout; it is currently hardcoded
   to a flat `dist/`.
4. **`web/data` collides.** burnoff's is a gitignored **symlink to `../data`**;
   firedamp's is a real directory holding the baked parquet. They cannot share a
   path.
5. **Two Pages deployments, one repo.** Both workflows are `name: Deploy`, both
   target `environment: github-pages`, both build `dist/`. GitHub Pages allows one
   deployment per repo; these must become one job emitting `dist/flaring/` +
   `dist/methane/`.
6. **Two incompatible cache-busters.** burnoff's `find`-based pass would sweep
   firedamp's files too and can double-stamp against firedamp's narrower rules.
   Pick burnoff's and parameterise its prune paths — `dist/s2/vendor` becomes
   `dist/flaring/s2/vendor` and the current literal silently stops matching.
7. **`rm -rf "$VENDOR"`** in the shared upstream vendor script makes two
   `make vendor` targets mutually destructive against one `web/vendor/`. Likewise
   firedamp's `clean-all` (`rm -rf web/vendor`) would destroy the tree both apps
   depend on.
8. **Every relative vendor import must gain a `../`** — five `<link>`/`<script>`
   tags per `index.html` and every `from './vendor/…'` in both apps. This is the
   bulk of the mechanical diff.
9. **Makefile target collisions**: `vendor`, `serve`, `deploy`, `help` exist in
   both, and `deploy` means *"push the signaling Worker"* in burnoff but *"build
   the private site and git push"* in firedamp. firedamp's `serve.py` hardcodes
   `DIRECTORY = "web"`; burnoff's takes it as `argv[2]` — keep burnoff's.

### Same name, different behaviour

This is where a merged codebase will actively mislead a reader.

- **`persistence`** — in burnoff a measured rate (detections ÷ clear looks,
  deliberately `null` when unmeasurable, `clustering.js:130`, `:179`) and a
  first-class slider. Firedamp has no such concept.
- **`detections`** — burnoff's maplibre source id *and* the archive table name;
  firedamp reads the same archive table but calls its features `plumes`. The
  table holds both kinds, which is why `s2archive.js:118` filters `kind='flare'`
  and `config.js:45` filters `kind='plume'`.
- **`flare`** — the dd marking both apps draw. burnoff steps it through a
  red→orange→white *intensity ramp* keyed on `max_b12`/`max_rh`; firedamp uses it
  as a flat *provider identity* colour. Same glyph, opposite semantics.
- **`isCovered` / `MIN_ZOOM`** — burnoff's `MIN_DETECT_ZOOM=11`,
  `MIN_VNF_ZOOM=6`, `MIN_ARCHIVE_ZOOM=4`; firedamp's `candidates.js` `MIN_ZOOM=13`
  and `licences.js` `MIN_ZOOM=6`. Five unrelated zoom floors named alike.
- **`resolve`** — burnoff's is `async`, switches mode, and polls up to 15 s for
  the parquet (`config.js:299`); firedamp's is synchronous over an in-memory
  collection (`config.js:76`).
- **`sources()` contract** — firedamp returns real data; burnoff returns an
  **empty** `detections` collection and drives it imperatively afterwards.
  Anything generic written against `ctx.sources` (the default table `pick`,
  `detail`'s `allFeatures`) sees nothing in burnoff.
- **`initArchive`** holds module-level singleton state (`archive.js:18`). Fine
  while the apps are separate documents; it becomes a real constraint if the
  merge ever puts both on one page.
- **`ICON` / `ICON_SIZE`** are the same expression under different names — an easy
  shared constant, but confirm before assuming: burnoff's is applied to a ramped
  `icon-image`, firedamp's to a fixed one.
