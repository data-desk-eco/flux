# a webgpu renderer in place of maplibre

asked 2026-08-29: could the gdn-gis gpu mapping work replace maplibre here.
this is what was found. the short answer is that two pieces of it are worth
taking now and the third — the one that actually removes the dependency — costs
a basemap pipeline and about a seventh of the audience.

## what gdn-gis is

`~/Tools/gdn-gis/web` is ~1,030 lines of es modules and wgsl, zero
dependencies, drawing a network of ~2.31 million pipes. it works because almost
everything is decided before the browser starts:

- **world space is a plane.** bng km (EPSG:27700), heights sampled from a
  terrain texture. an orbit camera (`camera.js`, 92 lines) gives `viewProj`,
  `project` and `screenToWorld` over that plane. there is no projection in the
  cartographic sense — no mercator, no globe, no lon/lat anywhere.
- **geometry is precomputed.** a 2,525-line rust builder writes fixed-width
  byte blobs sorted by a 2 km national grid cell, with a per-cell count array.
  offsets are the prefix sum, so any cell is one contiguous byte range.
- **paging is range requests.** `paging.js` (80 lines) turns the visible cell
  rect into coalesced `Range` fetches, keeps an lru of resident cells, and
  evicts past a per-layer cap.
- **drawing is instancing.** `render.js` builds one bind group layout and a
  pipeline per primitive; every vertex is expanded in the shader from a 12- or
  16-byte instance record. pipes, building walls and roofs, a terrain wire
  grid, a coast stencil fan, works rings.
- **text is dom.** `ui.js` keeps a pool of 40 `<span>`s, projects place
  coordinates on the cpu each frame, drops any label within 64 px of one
  already placed, and only touches the dom when a span's content or position
  actually changed.
- **picking is cpu.** the click re-fetches the clicked cell's bytes and
  projects candidate segments to screen space.

what it does not have: raster tiles, vector tiles, a sprite atlas, sdf glyphs,
a style language, a filter, or a second coordinate system.

## what flux asks of maplibre

- the dd dark basemap: `vendor/dd/style.dark.json`, 19 layers over carto vector
  tiles, with glyphs and a sprite served from `tiles.basemaps.cartocdn.com`,
  plus a `raster-dem` terrain source.
- **globe projection**, set on `style.load`.
- three esri raster satellite tiers behind a custom `esri://` protocol, which
  swaps the 2,521-byte "map data not yet available" placeholder for a
  transparent tile so the shallower tier shows through (`shell/map.js`).
- seven symbol layers — `detections`, `vnf`, `plumes`, `plumes-clusters`,
  `candidates`, `fx-highlight`, and `licences-label`. the first six draw on
  twelve icon images generated at runtime from the dd marking svgs (three
  flare-ramp colours, six quantitative, two structure marks, one highlight box)
  and registered with `addImage`, resolved lazily through `styleimagemissing`;
  `licences-label` is text-only and depends on the glyph endpoint instead.
- **geojson clustering.** the `plumes` source is supercluster-backed —
  `cluster: true, clusterMaxZoom: 4, clusterRadius: 30` with a
  `clusterProperties` aggregate, `rate_sum: ['+', ['coalesce',
  ['get','rate_kg_h'], 0]]` (`config.js:482`). this is a real algorithm, not a
  source option.
- a `circle` hit layer — deliberately invisible, stacked under `candidates` to
  widen the pointer target — `fill` and `line` for licence acreage, and two
  `image` sources: the MARS-S2L probability surface and the card's footprint
  overlay.
- style expressions evaluated per feature at render time: `step`,
  `interpolate`/`linear`, `coalesce`, `case`, `get`, `has`, `ln`, `typeof`,
  `zoom`, `==`, `!=`, `>=`, `!`, `+`, `/`, `round`, `concat` and
  `number-format`. no `match`, no `literal`.
- layer visibility through `getLayoutProperty`/`setLayoutProperty`, which is
  how the key's per-family rows switch a whole family off, and how `detail.js`
  decides whether a layer is clickable at all.
- `setPaintProperty` at runtime, for the card's `icon-opacity` dimming and the
  satellite `raster-brightness-max` under an overlay.
- `setPadding`, so the table drawer pushes the map over rather than covering
  it, and `getZoom` at nine sites gating whether a layer queries at all.
- `setData` per viewport, `setFilter`, `queryRenderedFeatures` for hover and
  click, `Popup`, `fitBounds` with padding, and the `#map=` hash.
- eased camera moves: `flyTo` in five places and `easeTo` in one. gdn-gis has
  no animated transitions — its camera snaps — so these are new code, small but
  fiddly to make feel right.

## the overlap is thinner than it looks

| gdn-gis has | flux needs it | note |
| --- | --- | --- |
| orbit camera over a plane | no | flux needs mercator, and currently globe |
| cell-indexed range paging | no | flux reads parquet through duckdb, per viewport |
| instanced draw of millions of records | no | flux draws thousands per viewport |
| terrain sampler | no | |
| dom label placement | **yes** | see below |
| coalesced range runs | maybe | if `data-desk/detections` ever gets a cell index |
| — | raster tile pyramid | not present |
| — | vector tile decode + tessellation | not present |
| — | sdf glyph atlas | not present |
| — | icon atlas | not present |
| — | expression evaluation | not present |
| — | point clustering with aggregates | not present |

the parts of gdn-gis that are genuinely hard are the parts flux does not need:
it exists because 2.3 million pipes cannot go through maplibre, and flux's
render load is a few thousand points that are already filtered in js before
they reach a source. the parts flux does need from a map engine, gdn-gis has
none of.

## what a replacement would actually cost

**the basemap is the whole job.** two ways out, and neither is small.

1. decode mvt, tessellate polygons, build an sdf glyph atlas, place labels with
   collision. this is rewriting maplibre, and doing it worse.
2. pre-render the dd dark style to raster tiles in the etl repo and blit them.
   this is tractable — `paging.js` is most of a mercator quadtree cache
   already — but it adds a tile pyramid to build, publish and host, loses
   crispness at fractional zoom, loses the globe, and loses collision between
   basemap labels and ours.

everything else ports cleanly, and some of it improves:

- **satellite tiers** are already raster; the placeholder swap is 10 lines
  either way.
- **markings** are svgs rasterised to an `Image`; into a texture atlas instead
  of `addImage` is a straight swap, and it drops the carto sprite.
- **text** would move to the gdn-gis dom-span pattern. this is a strict
  improvement: `layers.js` currently notes that rate labels are Montserrat and
  not Inter only because gl text needs sdf glyphs and the basemap's font
  endpoint serves no Inter stack. dom labels take the vendored Inter.
- **picking** becomes cpu hit-testing against the `FeatureCollection`s the app
  already holds in `CTX.sources`. flux only ever queries its own registered
  layers — `shell/map.js:113`, `shell/detail.js:47` — so
  `queryRenderedFeatures` has no use we would miss, and dropping it deletes a
  real wart: it serialises nested values to json and drops null ones, which is
  the only reason `norm`/`sameProps` exist in `detail.js`. hit-testing the
  source rows returns the rows themselves.
- **expressions** are a small closed set over four properties. `flareIcon`,
  `plumeIcon` and the band predicates would collapse into plain functions in
  `layers.js` — arguably clearer than the dsl, since `flareBands` already
  duplicates each step in js so the key and the map cannot drift.
- **clustering** is the one data-side thing that has to be written rather than
  ported. `clusterMaxZoom: 4` keeps the hierarchy shallow — it only clusters at
  world zoom — and the aggregate is a single sum, so this is a grid clustering
  pass over the plume rows, not supercluster. it is closer to
  `flaring/clustering.js`'s terminal grid than to anything in gdn-gis. but it
  has to keep `rate_sum` exact, and `plumes-clusters` reads it for the total
  label.
- **css** is a non-issue. three rules reference maplibre classes and all three
  suppress its chrome (`shell.css:9`, `vendor/dd/map.css:69-70`). the 69 KB
  stylesheet is almost entirely controls flux already hides.
- **globe** is gone unless written.

## the numbers that decide it

- maplibre is 910 KB of js and 69 KB of css. the duckdb engine is 24 MB
  vendored and ~7 MB over the wire. removing maplibre entirely saves about an
  eighth of the cold load, and `docs/cold-load.md` is where the seconds
  actually were.
- webgpu is at 85.6% global support (caniuse, 2026-08). safari only from 26.0;
  firefox is still not on by default. flux is a public map, so either maplibre
  stays as the fallback — and the dependency with it — or roughly a seventh of
  visitors get nothing.
- flux's frame cost is not the renderer. the two read tiers and the per-lane
  connections are what fixed the load, and both are upstream of drawing.

## what is worth taking anyway

1. **dom labels.** the span pool, cpu projection and 64 px collision test from
   `gdn-gis/web/ui.js`. it buys Inter for the rate labels and takes the carto
   glyph endpoint off the critical path. it can be done today, on maplibre,
   against `map.project()`.
2. **coalesced range runs.** `paging.js` merges adjacent cells into one
   request. `shell/data.js` reads whole objects or leaves them to the engine;
   if a card series ever needs a cell index, that merge is the shape to copy.

## if it were done anyway

three stages, each independently useful, and only the last removes anything:

1. markings to a texture atlas and rate labels to dom spans, still on maplibre.
2. draw `detections`, `vnf` and `plumes` in a webgpu canvas over the maplibre
   basemap, synced on `move`. this is where the gdn-gis renderer actually
   lands, and it is reversible.
3. pre-render the dd style to raster tiles, drop maplibre, keep it behind a
   `navigator.gpu` check as the fallback for the seventh of visitors without
   webgpu.

stage 3 is the only one that touches the dependency, and it ends with both
renderers in the tree rather than one.
