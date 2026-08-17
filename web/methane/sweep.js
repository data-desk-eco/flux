// the viewport sweep licence acreage runs (candidates read around an open card
// instead, and nothing else sweeps): refetch on moveend unless
// the viewport is still inside the padded rect last swept, one epoch so a slow
// read cannot land after a faster one, and a zoom floor below which the layer
// empties rather than sweeping a continent.

// sweeper(map, minZoom, fetchRect, apply) -> sweep(). fetchRect returning null
// (a read that failed and said so) leaves the swept rect unset, so the next
// moveend tries again.
export function sweeper(map, minZoom, fetchRect, apply) {
    let epoch = 0, swept = null;
    return async function sweep() {
        if (map.getZoom() < minZoom) { if (swept) { swept = null; apply([]); } return; }
        const b = map.getBounds();
        if (swept && b.getWest() >= swept.minX && b.getEast() <= swept.maxX
                  && b.getSouth() >= swept.minY && b.getNorth() <= swept.maxY) return;
        const px = (b.getEast() - b.getWest()) * 0.3, py = (b.getNorth() - b.getSouth()) * 0.3;
        const rect = { minX: b.getWest() - px, minY: b.getSouth() - py,
                       maxX: b.getEast() + px, maxY: b.getNorth() + py };
        const e = ++epoch;
        const out = await fetchRect(rect);
        if (e !== epoch || out == null) return;
        swept = rect;
        apply(out);
    };
}
