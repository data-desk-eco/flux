# Ras Laffan Complex — VNF Radiant Heat Monitoring

## Context

We're monitoring the Ras Laffan LNG complex (Qatar) for changes in
flaring activity during the Iran conflict. The complex contains 18
EOG-cataloged flare sites across Qatargas 1, Qatargas 2, RasGas 1-3,
and Qatar North Field LNG — all within ~3 km of each other.

Individual flare-level tracking is unreliable here because EOG's
flare site boundaries (watershed segmentation on a ~450m grid) don't
match our nightly backfill's nearest-neighbor assignment. At this
density, detection points get attributed to the wrong flare. Instead,
we aggregate all detection-point RH within a bounding box.

## Data source

**VIIRS Nightfire nightly ezCSV files** from EOG (v30), one per
satellite (NPP, NOAA-20/J01, NOAA-21/J02) per day.

URL pattern:
```
https://eogdata.mines.edu/wwwdata/viirs_products/vnf/v30/rearrange/{year}/{month:02d}/{sat}/VNF_{sat}_d{YYYYMMDD}_noaa_v30-ez.csv.gz
```

Requires EOG authentication (credentials in `.env` as `EOG_EMAIL` /
`EOG_PASSWORD`; auth flow in `scripts/fetch_vnf_profiles.py`).

Each row in the ezCSV is **one combustion source detected in one
satellite pass** — the local-maximum peak pixel of a merged cluster,
after bow-tie removal. RH (MW) is per-detection, derived via
Stefan-Boltzmann from Planck-fitted temperature and sub-pixel source
area.

## Bounding box

```
lat: 25.87 – 25.95
lon: 51.52 – 51.62
```

This covers all 18 flare sites in the Ras Laffan industrial area.

## Methodology

### 1. Fetch nightly ezCSVs

For each date in the study period, download all 3 satellite files.
Gunzip, parse as CSV. Filter rows to the bounding box using
`Lat_GMTCO` and `Lon_GMTCO`. Keep only rows where both `RH` and
`Temp_BB` are not the sentinel value `999999`.

Some files will 404 (no data for that satellite/date). That's normal.

### 2. Daily aggregate

Per date, compute:
- **total_rh**: sum of `RH` across all detection points in bbox
- **n_points**: count of detection points
- **max_rh**: maximum single-point `RH`
- **n_sats**: number of satellites with data (1-3)
- **points list**: individual (lat, lon, RH, Temp_BB, sat, time) for drill-down

### 3. Filtering for comparability

Only compare days with **2+ satellites**. Single-satellite days have
~50% less coverage and will appear artificially low. Flag days with
0 detection points but available satellite files as "clear, no
detections" (vs days with no files at all).

### 4. Baseline statistics

From the Jan 15 – Feb 27 2026 period (pre-escalation), the baseline
for days with 2+ satellites is:

| Stat | Value |
|------|-------|
| Mean daily total RH | 62 MW |
| Median | 66 MW |
| Std dev | 42 MW |
| P95 | 165 MW |
| Max single detection point | 21 MW |

### 5. What we found

Feb 28 onwards shows a step change:

| Date | Total RH | Max point | Sigma |
|------|----------|-----------|-------|
| Feb 28 | 165 MW | 34 MW | +2.2σ |
| Mar 4 | 196 MW | 54 MW | +3.0σ |
| Mar 5 | 157 MW | 44 MW | +2.0σ |

The signal is present independently on NPP, J01, and J02. It persists
across two consecutive days. Individual detection-point RH values
(40-54 MW) are 2-3x the pre-Feb 28 maximum (21 MW).

## Key pitfalls

**Do not use per-flare data from the parquet for this analysis.** The
nightly backfill (`scripts/backfill_nightly.py`) uses 2 km
nearest-neighbor matching which misattributes detections at dense
sites. EOG uses watershed segmentation which we can't replicate.

**Do not average RH across detection points.** Each ezCSV row is
already one source. Sum them for complex-level total output.

**Watch satellite count.** A day with only 1 satellite looks like a
dip but is just reduced coverage. Always note `n_sats`.

**Cloud gaps are real.** Days with 0 detections but available files
likely had cloud cover. Don't interpolate or treat as zero activity.

**Profile data ended ~Feb 12.** Before that date, the parquet has
per-flare per-pass data from EOG's profile CSVs (with cloud masking
and proper watershed attribution). After Feb 24, data comes from our
nightly backfill. There's a gap from Feb 13-23 with degraded profile
coverage. For a consistent series, use raw nightly ezCSVs throughout.

## EOG methodology reference

- Each nightly ezCSV row = peak pixel of a detection cluster
- RH = σT⁴ × ESF × Area_pixel (Stefan-Boltzmann)
- Adjacent pixels merge if RH ≥ 75% of local max; merged RH is summed
- Flare sites defined by watershed segmentation of multiyear detection
  density on a 15 arc-second grid — not a fixed radius
- Profile CSVs aggregate multiple detection peaks per pass per flare
  by averaging (not summing)
- v40 (2026) uses Dirichlet-process Gaussian mixtures for
  super-resolution at dense facilities

Sources: Elvidge et al. 2016 (Energies 9:14), Elvidge et al. 2013
(Remote Sensing 5:4423), Zhizhin et al. 2026 (Remote Sensing 18:314).
