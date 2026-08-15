# Why VNF flare cards are slow to open

Measured 2026-07-30 against the live archive, headless Chrome over a
33 ms-RTT link to `s3.WAW3-2.cloudferro.com`.

Kept as the record of a backend flux no longer runs: every cost below is
hyparquet's, and cartograph reads through DuckDB now, where `where` compiles to
a SQL predicate and no rejected row reaches JavaScript. Read it for the shape of
the table and how it was measured, not for what to optimise next.

## What we measured

Opening a VNF card calls `fetchVNFDetections(flare_id)` (`web/vnf.js:128`),
the only reader of the big daily parquet. Cold, that costs about **4.5 s**;
warm (footer already open) about **1 s**. Timings for flare 4998 (Qatar,
958 detections):

| stage | ms |
|---|---|
| hyparquet + compressors import | 254 (once per session) |
| `HEAD data.parquet` | 53 |
| footer bytes — 2.02 MB, fetched twice | 241 |
| footer thrift parse — 2,099 row groups × 12 columns | 228 |
| row-group fetch + decode — 66 range requests, 1.5 MB, **559,574 rows** | 3,090 |
| `norm()` over all 559,574 rows | 568 |
| filter down to the **958** rows the card wants | 79 |

Of that 3,090 ms, only ~730 ms is network: replaying the same 66 byte
ranges with `curl --parallel-max 6` (what a browser allows over HTTP/1.1)
takes 0.73 s, and at 32-way 0.43 s. **The remaining ~2.4 s is JavaScript
decoding half a million rows in order to keep 958 of them.**

## Why so many rows

`views/vnf/data.parquet` is 539 MB, 106.3 M rows — the full flare × night
calendar, one row per flare per night since 2012-03. It is Hilbert-ordered
over (lon, lat), which is right for the viewport tier but wrong for this
read: `flare_id` is scattered across that ordering, so a single row group
spans **1,734 flare ids on average** (median 1,077, max 13,331). Footer
statistics can prune almost nothing on `flare_id`.

The `lat`/`lon` ±0.01 box in the query is already a workaround for this —
without it the read would touch far more. Even with it, flare 4998
survives 11 row groups in 9 contiguous spans, scans 559,574 rows and
discards 99.8% of them; across a 61-flare sample the mean is 21 surviving
row groups. Only 11.6% of the file's rows are detections at all (12.3 M of
106.3 M).

Two smaller costs compound it. hyparquet's initial footer fetch is 512 KB
(`initialFetchSize`), so a 2.02 MB footer is fetched twice. And CloudFerro
serves **HTTP/1.1 only** — no h2, no h3 — so those 66 range requests queue
six at a time behind the browser's per-host connection cap. Responses also
carry no `Cache-Control`, so nothing survives a reload.

## What would fix it, in order of size

### 1. Give card opens their own tier — ~4.5 s → ~0.3 s

The card needs `date` and `rh_mw` for detected nights only. Build that as
a separate object, sorted by `flare_id`:

```sql
copy (select flare_id, date, rh_mw from data.parquet
      where detected order by flare_id, date)
to 'detections.parquet' (format parquet, compression zstd, row_group_size 20000);
```

Built and measured: **62 MB** (vs 539 MB), **140 KB footer** (vs 2.02 MB),
602 row groups. A card open then touches **one** row group — 20,480 rows
scanned instead of 559,574:

| flare | spans | rows scanned | ms |
|---|---|---|---|
| 4998 (958 detections) | 1 | 20,480 | 49 |
| 1 (381) | 1 | 20,480 | 30 |
| 2934 (75) | 1 | 20,480 | 26 |

Opening the file (HEAD + footer + parse) drops from 522 ms to ~120 ms.
Add the remote round trips for three column chunks (~100 KB) and a cold
card lands near **0.3 s**, warm near 0.05 s.

This is an ETL change in `~/Tools/etl` plus one line in `web/vnf.js`
pointing `fetchVNFDetections` at the new sibling and dropping the `lat`,
`lon` and `detected` predicates — which also removes the 370 KB
`flares.parquet` fetch from the card's critical path. `data.parquet` stays
as it is for anything that needs the full calendar.

### 2. Filter before normalising — saves ~550 ms today

`read()` in `web/vendor/cartograph/data-core.js` does `.map(norm)` over
every scanned row and *then* `.filter(matches)`. Normalising 559,574 rows
costs 568 ms; filtering first and normalising the survivors costs 11 ms.
`norm` rebuilds each row with `Object.entries`/`fromEntries` and turns
every `date` into an ISO string, so the waste is real.

The catch is that `matches` compares raw values: bigints compare fine
against numbers, but a `Date` never compares against a date string. So the
fix is to normalise per compared cell inside `matches` rather than to
reorder the two passes wholesale. This lives in vendored cartograph, so it
belongs upstream in `~/Tools/cartograph`. It benefits the S2 archive reads
as well.

### 3. Put Cloudflare in front of the bucket — ~0.3–0.6 s cold, more on repeat

Worth doing, and it uses infrastructure already paid for, but it is the
third lever rather than the first: it addresses the ~730 ms of network,
not the ~2.4 s of decode.

Point a proxied (orange-cloud) hostname such as `archive.datadesk.eco` at
`s3.waw3-2.cloudferro.com` and rewrite the Host header — Cloudflare's
Cloud Connector is the documented route for object-storage origins, with
Origin Rules as the manual alternative. Then change the two `<meta>` tags
in `web/index.html`. What that buys:

- **HTTP/2 and HTTP/3 to the browser**, so range requests multiplex on one
  connection instead of queuing six at a time. Our replay puts the ceiling
  at 0.73 s → 0.43 s for today's 66-request pattern.
- **TLS and TCP terminated at a nearby edge**, replacing a 120 ms Warsaw
  TTFB per wave with an edge round trip.
- **Edge caching** with a cache rule (`.parquet` is not a default-cached
  extension, so it needs "Eligible for cache"), plus `Cache-Control:
  public, max-age=…, immutable` set at upload time in
  `data-desk/infra/store.sh` — which the archive lacks entirely today.

One caveat: Cloudflare's maximum cacheable object is **512 MB** on Free,
Pro and Business (5 GB on Enterprise). The current 539 MB `data.parquet`
is *over* that line — it would be proxied but never cached. The 62 MB tier
from §1 sits comfortably under it, so the two changes reinforce each
other. It also speeds up the S2 archive's per-tile cluster reads.

### 4. Two free client-side trims — ~150–250 ms

- Pass `{ initialFetchSize: 4 << 20 }` to `parquetMetadataAsync` so a
  footer over 512 KB is fetched once, not twice. Moot after §1 shrinks the
  footer to 140 KB, but free until then.
- `asyncBufferFromUrl` issues a `HEAD` purely to learn `byteLength`
  (53 ms). Passing a known length, or letting the first ranged GET report
  it from `Content-Range`, removes a round trip.

## Recommendation

Do §1. It is a rebuild in the etl repo and a one-line change here, it
removes roughly 95% of the latency, and it shrinks the object under
Cloudflare's cache ceiling. Then §3, which helps every archive read the
site makes, and §2 upstream in cartograph. §4 only if §1 is deferred.

## Sources

- [Cloudflare cache — default behaviour and size limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [Cloudflare Origin Rules — change URI path and Host header](https://developers.cloudflare.com/rules/origin-rules/tutorials/change-uri-path-and-host-header/)
