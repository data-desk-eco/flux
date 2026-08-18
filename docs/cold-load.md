# Cold load: time to the first points

Measured 2026-08-18 against the live archive, in headless Chromium, with the
vendor assets served locally. The link to `s3.WAW3-2.cloudferro.com` has a
~35 ms round trip. The sibling record for card opens is
`vnf-card-latency.md`.

## What we measured

Time from navigation to the first features in each GeoJSON source, polled at
50 ms. Five baseline runs in the afternoon window put the first points (S2 and
plumes together) at 4.4–5.3 s, and the VNF layer at 5.9–6.9 s.

Store latency moves these numbers. Evening runs of the same build came in near
2.5 s. Every comparison below pairs runs from the same window.

## Where the time went

A Chromium netlog of one baseline load shows 116 requests to the store, all
serial. Four costs compound:

1. **The mount waited for the plume read.** `sources()` in `web/config.js`
   awaited `readPlumes` over four provider objects plus the attributions
   table before the map got any layer at all. The S2 flares table was resident
   at ~1.2 s and first drew at ~4.4 s.
2. **Each remote statement paid its own open dance.** One statement cost about
   five requests: a length probe, an aborted full-object GET, footer ranges,
   then data ranges. That is 300–550 ms per statement at this round trip, and
   a 147 kB object (`sron/detections`) cost the same turns as a 2 MB one. Six
   statements ran, one at a time, before the first paint.
3. **The availability index sat in the middle of the queue.** The quarter-dot
   reads (three columns, the full grid span, every provider) were queued at
   `ready()` and landed between the VNF init and the VNF viewport read. They
   delayed the VNF first paint by ~1.2 s and no pixel needed them first.
4. **`eog/flares` has one row group.** The viewport predicate could prune
   nothing, so each pan re-fetched ~1.9 MB of the 2.1 MB object. Range
   responses are never cached by the browser, and the store sends no
   `Cache-Control` on parquet, so nothing survived a reload either.

The objects the first paint touches:

| object | size | row groups | note |
|---|---|---|---|
| `data-desk/flares` | 0.9 MB | 1 | read whole, resident (unchanged) |
| `eog/flares` | 2.1 MB | 1 | one group, so bbox stats prune nothing |
| `carbon-mapper/detections` | 0.5 MB | 1 | display read fetched 512 of 528 kB |
| `imeo/detections` | 0.8 MB | 1 | |
| `sron/detections` | 0.1 MB | 1 | |
| `data-desk/detections` | 60 MB | 27 | plumes prune to 1 group on `kind` stats |
| `data-desk/attributions` | 1.0 MB | 1 | paragraph and evidence dominate |

## What changed

One strategy, stated in `web/shell/data.js`: an object small enough to hold is
fetched whole, in parallel, at page parse, and registered as an engine buffer.
An object past the 8 MB cap stays on remote range reads, and every prefetch
falls back to the url on failure. With that in place:

- `sources()` no longer waits for the plume read. All three layers start
  empty and `ready()` fires their first reads together.
- The quarter-dot availability read runs after the first plume paint.
- The VNF init no longer runs a `parquet_metadata` warm-up statement.
- `index.html` preconnects to the store and the basemap CDN.

Matched runs in the same window: first points 4.7 s → 2.2 s, and all three
layers on screen 6.4 s → 3.2 s. The drawn data is identical to the previous
build. Feature counts, the summed plume rate, the attribution count, the
dot-grid state, and the two deep-link families were compared.

The ranged tier still serves what is too big to hold: `data-desk/detections`
(the plume display read and the S2 card series), the partitioned
`eog/detections` (VNF card series), and the infrastructure tables (card
candidates). Those reads keep the footer-statistics path and the statement
queue.

What we tested and left alone: `SET enable_object_cache` changed nothing,
because the engine already holds footer metadata for the session (repeat
statements cost ~200 ms before and after). Column projection on
`data-desk/flares` no longer saves bytes, because the prefetch takes the whole
object either way.

## What would help next, on the store side

1. **`Cache-Control` on parquet at upload.** The prefetch GETs are plain
   full-object requests, so they cache normally once the header exists.
   `public, max-age=300` matches what `index.json` already gets. Today only
   heuristic caching applies, and it expires in minutes on a fresh upload.
2. **A proxied hostname in front of the bucket** (`vnf-card-latency.md` §3,
   still not done). HTTP/2 multiplexes the ranged tier, the edge caches the
   prefetched objects, and every object is now under the 512 MB cache
   ceiling.
3. **An order contract for `data-desk/detections`.** The plume read prunes 26
   of 27 row groups only because the plume rows sit in the tail group by
   append order. Sort on `(kind, cell, site_id, date)` and assert it in the
   table's checks, or split the plumes into their own object. Without one of
   these, interleaving degrades the read silently.
4. **Narrower numbers in `eog/flares`.** The nested `rh_sum` and `rh_max`
   are ~1.0 MB of the 2.1 MB object. Float32 is enough for radiant heat and
   halves the prefetch.
5. **Move the detector-internal scoring columns out of `data-desk/flares`.**
   `max_ratio`, `score`, `glint_penalty` and kin are ~0.35 MB of 0.95 MB, and
   the map reads none of them.

## Deploy note

The public map is stale. GitHub `main` is `dbcfa328` (2026-08-04), the Deploy
workflow last ran that day, and the local `burnoff` checkout has not pushed
since. The served build predates the 2026-08-17 refactor, still requests
`s2/vendor/geotiff.js`, and fails to mount when measured. Push `burnoff` to
GitHub to ship the last two weeks, this change included.

Separately, Pages serves the engine gzip (5.7 MB). A brotli-capable front
trims about 20%.

## Reproduction

```bash
make serve
# first-feature timing: poll window.flux.map.getSource(id)._data.features
# request cascade: chromium --log-net-log, filter events to the store host
```
