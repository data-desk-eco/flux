# flux

one map of two ways the oil and gas industry puts carbon into the air: gas it
burns and gas it leaks. flaring is Sentinel-2 archive clusters (S2) and VIIRS
Nightfire looks (VNF), a layer each and both drawn at once; methane plumes are
the third layer. one quarter grid sets the date window for all three, and a
quarter greys only when no layer covers it.

flux reads parquet off the Data Desk archive with DuckDB and draws it, and does
nothing else: no detection, no publishing, no live third-party api. the one
exception is `/review`, behind cloudflare access: a person's verdict on each
new attribution goes to `worker/review.js`, and the jump host folds it into the
archive. the map shows a claim from a later run only once it is confirmed.

`web/config.js` is the declaration `mount()` takes; everything flux-specific
lives in the hook modules it wires in. `web/shell/` is the map shell,
first-party since 2026-08-17 (it was the cartograph library): change it here,
and delete what only a second consumer would have wanted.

zero npm dependencies. MapLibre GL and DuckDB-Wasm lite are vendored; everything
else is browser built-ins.

## the brand

the ui is built on `vendor/dd/dd.js`, the kernel the data desk `design`
repository compiles from mikael dahlén's guidelines: `dd-panel`, `dd-key`,
`dd-row`, `dd-btn`, `dd-dot`, `dd-slider`, `dd-toggle`, `dd-label`,
`dd-logo`, which draw their own chrome in shadow roots, and the basemap,
markings and graded imagery. flux css places and sizes them and styles what
it puts in them, in `--dd-*` tokens only. `make audit` runs
`vendor/dd/audit.js` over the intro, the map and a card, and fails on any
deviation not declared in `AUDIT` (`layers.js`): viridis, two gl text layers,
the data rasters. a new deviation is a line there, argued in its comment.
change the elements in the design repository, never in vendor/.

## the three families

**S2 flaring.** `flaring/s2archive.js` reads `data-desk/flares` (one row per
cluster, its quarterly history nested in `quarters`) once and answers every
viewport, and the intro map's `coverage()`, from those rows.
`data-desk/detections` holds the per-date series, read per cluster on card
open. the methodology is s2-flares, run in the etl; flux is a viewer.

**VNF flaring.** `flaring/vnf.js` reads `eog/flares` for the viewport and
`eog/detections` per site on card open. every detections row is a positive
detection; the looks that found nothing are `eog/observations`, which flux does
not read (see invariants).

both are named after the export LNG terminal they sit on, where one is within
7.5 km: `flaring/terminals.js` reads them off `gem/infrastructure` on the card
lane, and a site drawn before they land is renamed on the next refresh.

**methane.** `methane/plumes.js` reads every provider's plume detections for
the ticked window, the wind at the plume among them (`wind_ms`,
`wind_from_deg`, extension columns the etl takes from each producer's own
wind; sron has none). `methane/attribution.js` stamps ch4id's attributions on,
`methane/candidates.js` reads the `infrastructure` tables around an open plume
card and nowhere else (there is no standing infrastructure layer),
`methane/overlay.js` drapes a Data Desk probability surface, and `methane/mask.js`
reads the open plume's outline from its provider's `masks`.

no module names an archive object. `<meta name="data-bucket">` gives the bucket
and `index.json` says which object each table is and whether it is partitioned,
so a table that starts partitioning does not break a reader.

## layout

```
web/
  config.js          the declaration: sources, layers, the one refresh path,
                     quarter availability, the table's tabs, deep links
  layers.js          marking / ramp / colour policy and the key's bands.
                     shape categorises, colour is measurement
  key.js             the key: a group of bands per family
  sites.js           data-desk/sites, the outlines a detection sits in
  card/              one header, one body per feature kind
    index.js         the registry, the shared series card,
                     reselectCurrentFeature
    overlays.js      the open card's map overlays
    chart.js         the intensity chart
    flare.js vnf.js plume.js   the bodies
  flaring/
    render.js        MODE: the scale each instrument reads on, the S2 floor
    clustering.js    sumQuarters, the feature builders, the terminal lookup
    terminals.js     gem's export lng terminals
    s2archive.js     data-desk/flares + detections, coverage()
    vnf.js           eog/flares + eog/detections
  methane/           plumes.js reader, attribution.js, candidates.js,
                     overlay.js, mask.js
  shell/             app.js mount, map.js, ui.js, detail.js, table.js,
                     quarters.js, data.js reads, engine.js the duckdb
                     worker, archive.js index, util.js
  review/            the /review page: index.html and review.js
  vendor/            dd kernel (dd.js, audit.js) and basemap, duckdb,
                     maplibre, inter (300-800, italic)
worker/              the review api and its d1 schema
scripts/             vendor.sh, dist.sh, serve.py
test/                the rate rules, in node:test
```

## commands

```bash
make serve     # static server on :8000
make test      # the rate rules (node --test)
make audit     # the ui against the brand, headless (needs ~/data-desk browse)
make vendor    # re-vendor maplibre, duckdb, the dd kernel, inter
make dist      # the pages artifact, assertions and all
```

no `npm install`, and no build step. examine DOM logic in the browser
(`skills/browser/browse` in `~/data-desk`), not only in the tests.

## invariants

these were arrived at through production incidents. several are one refactor
away from being broken silently, and they compile and run either way.

**persistence is a ratio, so guard both halves.** numerator and denominator
must cover the same looks. `clear` is the cloud-free look count persistence
divides by; `observations` is every look. the only numerator that pairs with
`clear` is `detections_clear`. never divide `detections` by `clear` — that
broke `lng-flaring` — and reading `observations` where `clear` belongs
silently redefines persistence.

**one reducer.** both families go through `sumQuarters` in
`flaring/clustering.js`. it returns null, not 0, for any field absent from any
quarter in the window: summing that as zero turns "we never counted the
passes" into "no pass was ever made". keep it the single path.

**do not wire through the published `persistence` column** for the card's
rate: the app recomputes over exactly the ticked quarters, and the published
value would stop the quarter picker affecting the number. its use is as the
gate's `rank` fallback (`clustering.js`), a different question.

**the two null branches stay split.** in S2 a null persistence is unrated and
passes the gate; in VNF it is a finding — no clear night — and the flare is
dropped. the split is the last argument of `persistenceFilter` (`config.js`),
`0` for S2 and `-1` for VNF; the gate is `>= 0`. the old slider at 0.25 sank
the whole archive when S2 coalesced to 0.

**intensity is the key's.** there is no persistence slider: it only hid
flares. B12 reflectance and radiant heat
are not one scale. `MODE.s2.floor` is the published quality gate (a constant,
on the site's *average*; VNF has none), and the key's rows filter above it, on
the *maximum*, at exactly the breaks `flareIcon` steps at — `flareBands` in
`layers.js` keeps the two in step. a row passes a feature it is no statement
about (`p.kind !== kind || …`, `key.js`), so switching a group off drops that
family and nothing else.

**floors:** `MIN_LOOKS = 10` for S2, `COVERAGE_MIN = 0.8` for VNF, both in
`clustering.js`. below them, publish no rate; the card shows an em dash.

**`reselectCurrentFeature()` is load-bearing.** every dot carries the numbers
for the ticked quarters alone, and an open card holds a copy. every layer
refreshes through the one `refresh(id)` in `config.js`, which ends in it; a
new layer goes in `READS` and gets that for free. a card reads no layer but
its own: when only others moved, its re-render is a no-op (detail.js compares
properties, rightly — a rebuild would drop the reader's selected date).

**units and types.** MCM/d is `rh_mw × 0.0315` (JZ-RH, Zhizhin et al. 2025);
`RH_TO_MCM` in `flaring/render.js` is the only place it is spelled. EOG's own
`flow_mcm` must never be displayed — the legacy power law overestimates dim
flares and underestimates bright ones. identifiers are VARCHAR in every table;
never coerce with `Number()` (`card/index.js` compares `String(id)`), and never
match on coordinates: an 11 m match handed two close sites each other's card.

**no H3 in the browser.** nothing computes a cell; it only passes one on, which
lets a card name one object without a bucket listing — so plumb `cell` through
any new feature builder.

**flux does not read `eog/observations`, deliberately.** the quarters list
already carries the looks, windowed the same way as the numerator. a second
read is a second place to get the pairing wrong.

**at dense complexes:** sum radiant heat across detection points rather than
averaging, always check `n_sats`, and read a day with files but no detections
as cloud, not as zero activity (`docs/ras-laffan-monitoring.md`).

**the negation in the S2 intensity gate is deliberate.**
`!(c.avg_b12 < MODE.s2.floor)` (`config.js`) lets a cluster the
table gives no intensity for through: `undefined >= 0.85` is false for every
row.

**VNF has no intensity floor.** a 3 MW floor on the average hid every dim
flare — most onshore gas plants, and the LNG trains at Darwin and Ichthys.
persistence is VNF's only gate.

**`flareIcon` coalesces a missing value to `stops[0]`** (`layers.js`): a site
with no value flattens the ramp rather than vanishing. a plume is the other way
round: no rate is not a low rate, so it is grey, off the ramp and out of every
band.

**two ramps, because they answer different questions.** flaring reads on the
dd intensity ramp (red → orange → white), methane on viridis, the ramp the
plume rasters are rendered in. colour never means provider or category — that
is shape's job.

**a lane is a connection, and the engine serialises each one.** statements on
one connection run one after another; on different connections they overlap
without touching each other's staged ranges. `sql()` and `read()` take a
`lane`, and `.query()` is called in exactly one place. the map is the default
lane and card opens (and the terminal read) are `lane: 'card'`: sharing one
made a pan wait for a card, 6.1 s against 1.3 s. flux issues no `CREATE`, so a
lane is only a parallelism choice. add one when work must not wait behind
other work, never one per provider.

**two read tiers, and size picks the tier.** every object under the 8 MB cap is
fetched whole at page parse, racing the engine download, and registered as an
engine buffer (`prefetchData`, `shell/data.js`). what is past it stays on
ranged reads, which is also every prefetch's fallback. a card series goes
through `memoised()` (30 MB, least recently used): the rows are shared — read
them, do not write them. do not put the first paint behind a ranged read again
(`docs/cold-load.md`).

**the engine is ~7 MB over the wire, and the first load after a deploy pays for
it.** one cold-edge load took over two minutes to mount where a warm one takes
about eight seconds. it is the deploy that is cold, not the map.

## the tables

the etl that publishes everything this map reads lives in `~/data-desk/etl`;
`sql/tables/` there holds the definitions and their `*.checks.sql`, which state
exactly what a reader may rely on.

- `data-desk/flares`, `data-desk/detections` — S2 clusters and their per-date
  series. flares carries `quarters`: `quarter, days, observations, clear,
  detections, detections_clear, rh_sum, rh_max`.
- `eog/flares`, `eog/detections` — VNF sites and their nightly detections, the
  same `quarters` struct. `eog/observations` exists and is not read here.
- `<provider>/detections` — methane plumes, `kind = 'plume'`, with `valid`
  false on a retrieval the producer does not trust, and `wind_ms`,
  `wind_from_deg` where the producer gives a wind.
- `<provider>/infrastructure` — candidate sources, Hilbert-clustered on
  lon/lat; gem's `lng_terminal` rows name the flares.
- `data-desk/attributions` — ch4id's plume → source contract.
- `data-desk/sites` — the osm outline of every industrial facility a flare
  or plume can come from (oil and gas, coal, steel, cement, power, waste),
  `outline` as geojson and a box. 88k rows, so read for the viewport from
  z10, and an outline is drawn only while a drawn detection is inside it
  (`drawSites`, on `fx-filters`). it names no detection, so a flare's
  facility is what the reader sees it inside.
