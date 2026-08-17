// the rules a rate is computed under, held in place. everything here is pure —
// clustering.js takes no dom and no app state — and every case below is one a
// production incident is written against in CLAUDE.md.
//
//   node --test test/

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sumQuarters, archiveFeature, enrichVNFFeatures, setTerminals }
    from '../web/flaring/clustering.js';

setTerminals([]);   // no terminal is near anything here, so names stay derived

const KEYS = new Set(['2026_1', '2026_2']);
// a quarter key is a date inside its own quarter, which is how the reducer's
// window predicate and the archive's `quarter` column meet
const Q = (quarter, o = {}) => ({
    quarter, days: 90, observations: 80, clear: 40,
    detections: 20, detections_clear: 10, rh_sum: 100, rh_max: 5, ...o,
});
const all = () => true;

describe('sumQuarters', () => {
    it('sums the kept quarters and counts them', () => {
        const t = sumQuarters([Q('2026-01-01'), Q('2026-04-01')], all);
        assert.equal(t.n, 2);
        assert.equal(t.clear, 80);
        assert.equal(t.detections_clear, 20);
        assert.equal(t.rh_max, 5);
    });

    it('keeps only the quarters the window admits', () => {
        const t = sumQuarters([Q('2026-01-01'), Q('2025-01-01')], q => q.startsWith('2026'));
        assert.equal(t.n, 1);
        assert.equal(t.clear, 40);
    });

    // summing a null as zero turns "we never counted the passes" into "no pass
    // was ever made", which a caller then reads as a measurement
    it('returns null for a field any kept quarter is missing', () => {
        const t = sumQuarters([Q('2026-01-01'), Q('2026-04-01', { clear: null })], all);
        assert.equal(t.clear, null);
        assert.equal(t.detections, 40);
    });

    it('an empty window measures nothing rather than zero', () => {
        assert.equal(sumQuarters([Q('2026-01-01')], () => false).n, 0);
    });
});

describe('archiveFeature', () => {
    const site = (quarters, o = {}) => archiveFeature(
        { id: 'a1', cell: '81013ffffffffff', lat: 25, lon: 52, quarters, ...o }, KEYS).properties;

    // the only numerator that pairs with `clear` is `detections_clear`
    it('divides clear-sky detections by clear-sky looks', () => {
        const p = site([Q('2026-01-01'), Q('2026-04-01')]);
        assert.equal(p.detection_count, 20);
        assert.equal(p.observations, 80);
        assert.equal(p.persistence, 20 / 80);
    });

    // below MIN_LOOKS a rate is noise: report the count and no rate
    it('publishes no rate under the looks floor', () => {
        const p = site([Q('2026-01-01', { clear: 4, detections_clear: 2 })]);
        assert.equal(p.detection_count, 2);
        assert.equal(p.persistence, null);
    });

    // s2 can write several blobs for one site on one day, so the numerator
    // counts rows where the denominator counts days
    it('clamps a rate the grain can push over 1', () => {
        assert.equal(site([Q('2026-01-01', { detections_clear: 400 })]).persistence, 1);
    });

    // no cloud mask: every pass is the denominator, and the card says the
    // cloud-free count is unknown rather than claiming one
    it('falls back to every look where no clear count is published', () => {
        const p = site([Q('2026-01-01', { clear: null, detections_clear: null })]);
        assert.equal(p.detection_count, 20);
        assert.equal(p.observations, null);
        assert.equal(p.persistence, 20 / 80);
    });

    // the gate ranks on the window's rate, then the published one, and leaves a
    // site nothing has ever rated unrated — 0 would hide it behind the slider
    it('ranks on the window, then the published rate, then not at all', () => {
        assert.equal(site([Q('2026-01-01')], { persistence: 0.9 }).rank, 0.25);
        assert.equal(site([Q('2026-01-01', { clear: 4, detections_clear: 2 })],
            { persistence: 0.9 }).rank, 0.9);
        assert.equal(site([Q('2026-01-01', { clear: 4, detections_clear: 2 })]).rank, null);
    });
});

describe('enrichVNFFeatures', () => {
    const look = (o = {}) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [52, 25] },
        properties: { id: 'v1', cell: '81013ffffffffff', avg_rh: 10, max_rh: 20,
                      detection_dates: 30, observations: 60, passes: 80,
                      coverage: 0.95, ...o },
    });
    const one = (o, minRh = 0) => enrichVNFFeatures([look(o)], minRh);

    it('divides clear nights lit by clear nights read', () => {
        assert.equal(one()[0].properties.persistence, 0.5);
    });

    // never seen is not unlit: under the coverage floor, or with no clear night
    // at all, vnf publishes no rate — and the layer filter then drops the site
    it('publishes no rate under the coverage floor', () => {
        assert.equal(one({ coverage: 0.5 })[0].properties.persistence, null);
    });

    it('publishes no rate for a window holding no clear night', () => {
        assert.equal(one({ observations: 0 })[0].properties.persistence, null);
    });

    it('drops a site under the intensity floor, and keeps it at floor 0', () => {
        assert.equal(one({ avg_rh: 1 }, 3).length, 0);
        assert.equal(one({ avg_rh: 1 }, 0).length, 1);
    });
});
