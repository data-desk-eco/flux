# flux

one map of two ways the oil and gas industry puts carbon into the air: gas it
burns and gas it leaks. flaring is Sentinel-2 archive clusters (S2) and VIIRS
Nightfire looks (VNF), a layer each and both drawn at once; methane plumes are
the third layer. one quarter grid sets the date window for all three, and a
quarter greys only when no layer covers it.

flux is the merge of burnoff (flaring) and firedamp (methane). it is a
cartograph consumer (`~/Tools/cartograph`): `web/config.js` is the declarative
config passed to `mount()`, and the shell, key, quarter picker, sliders, detail
panel, data table and permalinks are all cartograph's, vendored under
`web/vendor/cartograph/`. everything flux-specific lives in the hook modules
config.js wires in.

zero npm dependencies. MapLibre GL, DuckDB-Wasm lite, geotiff.js and the s2e
rust core compiled to wasm are vendored; everything else — the CRDT, the WebRTC
mesh, the sync protocol, IndexedDB persistence, UTM math, the signal server's
WebSocket framing — is hand-rolled on web standards.

## the three families

**S2 flaring.** `flaring/s2archive.js` reads `data-desk/flares` (one row per
cluster, the site's quarterly history nested in a `quarters` list) through
cartograph's DuckDB layer, once, and answers every viewport from those rows.
`data-desk/detections` holds the per-date series, read per cluster on card open.
where the archive has no coverage the in-browser detector takes over: `Detect`
runs the s2e wasm core in a worker (`flaring/detect-worker.js`) and peers split
the blocks over WebRTC into one shared CRDT. that whole stack — crdt, sync, rtc,
store — is loaded lazily by `ensureDetect()` and a pure-archive session never
fetches it.

**VNF flaring.** `flaring/vnf.js` reads `eog/flares` for the viewport and
`eog/detections` per site on card open. every row in detections is a positive
detection; the looks that found nothing are `eog/observations`, which this app
does not read (see invariants).

**methane.** `methane/plumes.js` reads every provider's plume detections for the
ticked window — one object per provider, named by the archive index, read
independently so a missing one costs its own rows. `methane/attribution.js`
stamps ch4id's attributions on, `methane/candidates.js` sweeps the
`infrastructure` tables around a selection, `methane/overlay.js` drapes a
Data Desk probability surface, and `methane/licences.js` draws MapStand acreage
in the private build only.

no module names an archive object. `<meta name="data-bucket">` gives the bucket
and `index.json` says which object each table is and whether it is partitioned,
so a table that starts partitioning does not break a reader.

## layout

```
web/
  config.js          the cartograph config + orchestration: the key's four
                     groups, viewport queries, the quarter grid's availability,
                     the detect controls, deep-link resolve, the "also here"
                     groups
  layers.js          marking / ramp / colour policy for every layer, the key's
                     bands, and the shared layout blocks (PIN, RATE_LABEL).
                     shape categorises, colour means intensity, everywhere
  nearby.js          the "also here" row: what the other layers hold at an open
                     card's place, from collections the session already has
  card/              one header, one body per feature kind
    index.js         the registry, the shared series card (stats, intensity
                     chart, dated rows), the map overlays, reselectCurrentFeature
    flare.js         S2 site body       vnf.js   VNF look body
    plume.js         methane plume body
  flaring/
    render.js        the MODE tables: the scale and floor each instrument reads on
    clustering.js    terminal grid, sumQuarters, the feature builders
    s2archive.js     data-desk/flares + detections, and the coverage geojson
    vnf.js           eog/flares + eog/detections
    detect.js        local detect + p2p wiring          (lazy)
    detect-worker.js module worker: wasm block detector + COG I/O
    s2/              the s2e methodology core in-tree: stac/cog/geo I/O,
                     cluster/score JS, and the rust core as wasm in s2/wasm/
    crdt.js sync.js rtc.js store.js                     (lazy)
  methane/
    plumes.js        the plume reader: display read, availability index,
                     permalink read, and the provider label / rate helpers
    attribution.js   ch4id's attribution contract + the wind enrich hook
    candidates.js    infrastructure candidates around a plume, and the sweep
    licences.js      MapStand licence acreage (private build)
    overlay.js       the MARS-S2L probability surface over the basemap
    sweep.js         the viewport sweep both parquet layers run
  vendor/            cartograph, dd design system, duckdb, maplibre, fonts
  index.html         ~25 lines: meta config + vendor includes
  style.css          flux UI on top of cartograph's shell.css
scripts/vendor.sh    thin wrapper over cartograph's vendor.sh + the s2e wasm
signal/              WebSocket signaling: node relay (dev), Worker + DO (prod)
test/                determinism + p2p retry tests (node:test)
```

## commands

```bash
make serve     # static server on :8000 + signaling on :4444
make test      # determinism + p2p retry (node --test)
make vendor    # re-vendor cartograph + the s2e wasm core
make deploy    # signaling worker to Cloudflare
```

no `npm install`. after a change in `~/Tools/cartograph`, run `make vendor` here.
examine DOM logic in the browser (`skills/browser/browse` in `~/data-desk`), not
only in the tests.

## invariants

these were arrived at through production incidents. several are one refactor
away from being broken silently, and they compile and run either way.

**persistence is a ratio, so guard both halves.** numerator and denominator must
cover the same looks, or it is not a rate. `clear` is the cloud-free look count
persistence divides by; `observations` is every look an instrument took. the only
numerator that pairs with `clear` is `detections_clear`. never divide
`detections` by `clear` — that pairing broke `lng-flaring`, and reading
`observations` where `clear` belongs compiles, runs, and silently redefines
persistence.

**one reducer.** both modes go through `sumQuarters` in
`web/flaring/clustering.js`, so no caller can redefine persistence without
changing how it reads. it returns null, not 0, for any field absent from any
quarter in the window: summing that as zero turns "we never counted the passes"
into "no pass was ever made". keep it the single path if the feature builders
move again.

**do not wire through the published `persistence` column** for the card's rate.
the app deliberately recomputes over exactly the ticked quarters; the published
value would look right and make the quarter picker stop affecting the number. its
legitimate use is as the gate's `rank` fallback (`clustering.js`), which is a
different question.

**the two null branches stay split.** in S2 a null persistence means unrated and
passes the gate; in VNF a null is a finding — no clear night — and the flare is
dropped. the split is the last argument of `persistenceFilter` (`config.js`),
passed `1` where the layer is added for S2 and `0` for VNF. coalescing S2 to 0
sank the whole archive below the slider's default. do not fold them into one.

**intensity is the key's, not a slider's.** two families draw at once and B12
reflectance and radiant heat are not one scale, so there is no slider that can
carry both: `MODE[x].floor` is the published quality gate (a constant, on the
site's *average*), and the key's rows filter above it, on the *maximum*, at
exactly the breaks `rampIcon` steps at — `flareBands` in `layers.js` is where
the two are kept in step. a row a feature is no statement about passes it
(`p.kind !== kind || …`), which is what lets one key filter a map of several
sources; cartograph reads a feature every row admits as outside the section, so
switching a group off entirely drops that family and nothing else.

**floors:** `MIN_LOOKS = 10` for S2, `COVERAGE_MIN = 0.8` for VNF, both in
`clustering.js`. below them, publish no rate; the card shows an em dash.

**`reselectCurrentFeature()` is load-bearing.** every dot carries the numbers for
the ticked quarters alone, and an open card holds a copy rather than a reference.
all three refresh paths end in it — `refreshS2Archive`, `refreshVNF` and
`refreshPlumes` in `config.js`. a fourth must too. it also refills the "also
here" slot, which is the card's one part that reads the *other* layers: when
only they moved the card's own re-render is a no-op (detail.js compares
properties, and rightly — a rebuild would drop the reader's selected date).

**units and types.** MCM/d is `rh_mw × 0.0315` (JZ-RH, Zhizhin et al. 2025);
`RH_TO_MCM` in `flaring/render.js` is the only place it is spelled. EOG's own
`flow_mcm` is carried but must never be displayed — the legacy power law
overestimates dim flares and underestimates bright ones. identifiers are VARCHAR
in every table; never coerce with `Number()` (`card/index.js` compares
`String(id) === String(id)`, and never on coordinates: an 11 m coordinate match
handed two close sites each other's card).

**no H3 in the browser, and no second detector.** nothing computes a cell; it
only ever passes one on, which is what lets a card name one object without a
bucket listing — so plumb `cell` through any new feature builder
(`clustering.js` → `s2archive.js`, `vnf.js`). the wasm core stays the only
detector; a JavaScript port is how the in-browser pixel counts diverged from the
core before, and it was removed.

**flux does not read `eog/observations`, deliberately.** the quarters list
already carries the looks, windowed the same way as the numerator. a second read
is a second place to get the pairing wrong.

**at dense complexes:** sum radiant heat across detection points rather than
averaging, always check `n_sats`, and read a day with files but no detections as
cloud, not as zero activity. (`docs/ras-laffan-monitoring.md`.)

**the negation in the S2 intensity gate is deliberate.** `!(c.avg_b12 < MODE.s2.floor)`
in `config.js` lets a cluster the table gives no intensity for through rather
than vanishing: the shared flares schema has no site-level b12, and
`undefined >= 0.85` is false for every row.

**a link that names one flare has already chosen it.** `resolveSite` enriches at
floor `0`, the literal, not `MODE.vnf.floor` — under the 3 MW default every dim
flare resolved to nothing at all.

**`rampIcon` coalesces a missing value to `stops[0]`** (`layers.js`): a row the
producer gives no value for flattens the ramp rather than hiding the feature.

## the tables

the ETL that publishes what this map reads lives in `~/Tools/etl`; see
`sql/tables/` for the definitions and their `*.checks.sql`, which state exactly
what a reader may rely on.

- `data-desk/flares`, `data-desk/detections` — S2 clusters and their per-date
  series. flares carries `quarters`: `quarter, days, observations, clear,
  detections, detections_clear, rh_sum, rh_max`.
- `eog/flares`, `eog/detections` — VNF sites and their nightly detections, the
  same `quarters` struct. `eog/observations` exists and is not read here.
- `<provider>/detections` — methane plumes, `kind = 'plume'`, with `valid` false
  on a retrieval the producer does not trust.
- `<provider>/infrastructure` — candidate sources, Hilbert-clustered on lon/lat.
- `data-desk/attributions` — ch4id's plume → source contract.
