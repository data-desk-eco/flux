// shared helpers: formatting, geometry, and the pure logic behind filters and
// permalinks (kept dom-free so node can test them)

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// metres between two positions: the one distance this app measures, and it
// measures it in metres — a card's "also here" radius, and the terminal a flare
// is named after
export function haversineM(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

// metres -> degrees, for sizing a rect around a point. the cos guard keeps the
// longitude span finite at the poles
export const degLat = m => m / 111320;
export const degLon = (m, lat) => m / (111320 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg) {
    if (deg == null || isNaN(deg)) return '';
    return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export function fmtMetres(m) {
    if (m == null) return '?';
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function fmtCoords(lat, lon) {
    return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, `
         + `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}

export function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
}

// the data table's row math: viewport filter (bounds = [w, s, e, n]; rows
// without a lat pass), substring search over cols, null-last sort, cap
export function tableRows(all, { cols, bounds, q, sortCol, sortDir = 1, cap = 500, lat = 'lat', lon = 'lon' }) {
    const rows = all.filter(r =>
        (!bounds || r[lat] == null ||
            (r[lat] >= bounds[1] && r[lat] <= bounds[3] && r[lon] >= bounds[0] && r[lon] <= bounds[2]))
        && (!q || cols.some(c => String(r[c] ?? '').toLowerCase().includes(q))));
    if (sortCol) rows.sort((a, b) => {
        const x = a[sortCol], y = b[sortCol];
        return x == null ? 1 : y == null ? -1 : (x < y ? -1 : x > y ? 1 : 0) * sortDir;
    });
    return { rows: rows.slice(0, cap), total: rows.length };
}

// expand a bbox to at least `min` degrees per axis (centered). availability
// tests on a razor-thin zoomed-in viewport otherwise flip the moment you sit
// between features; a ~3 km floor makes them reflect the surrounding area
export function padBbox([w, s, e, n], min = 0.03) {
    const dw = Math.max(0, (min - (e - w)) / 2), dh = Math.max(0, (min - (n - s)) / 2);
    return [w - dw, s - dh, e + dw, n + dh];
}

// [w, s, e, n] of a polygon / multipolygon feature
export function featureBbox(f) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const [x, y] of f.geometry.coordinates.flat(f.geometry.type === 'MultiPolygon' ? 2 : 1)) {
        w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    }
    return [w, s, e, n];
}

// the quarter picker's date math: keys are "2025_3" strings

// {startDate, endDate} spanning the given quarter keys, or null when empty
export function quarterRange(keys) {
    let start = null, end = null;
    for (const k of keys) {
        const [y, q] = String(k).split('_').map(Number);
        const s = `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`;
        const e = `${y}-${String(q * 3).padStart(2, '0')}-${new Date(y, q * 3, 0).getDate()}`;
        if (!start || s < start) start = s;
        if (!end || e > end) end = e;
    }
    return start ? { startDate: start, endDate: end } : null;
}

export const quarterOf = dateStr =>
    `${dateStr.slice(0, 4)}_${Math.floor((+dateStr.slice(5, 7) - 1) / 3) + 1}`;

// true when the date falls in one of the quarter keys (empty set = no window)
export const dateInQuarters = (dateStr, keys) => !keys.size || keys.has(quarterOf(dateStr));

// #<key>=<id> permalinks, coexisting with maplibre's #map= hash
export function getHashParam(hash, key) {
    const m = hash.match(new RegExp(`${key}=([^&]*)`));
    return m ? decodeURIComponent(m[1]) : null;
}

export function setHashParam(hash, key, id) {
    const rest = hash.replace(/^#/, '').split('&').filter(p => p && !p.startsWith(`${key}=`));
    if (id != null) rest.push(`${key}=${encodeURIComponent(id)}`);
    return rest.length ? '#' + rest.join('&') : '';
}

// one app, several permalink keys: detail.hashKeys maps each key to the
// resolver for ids the loaded features do not carry (#site= and a legacy
// #vnf= may share one). detail.hashKey is sugar for a single such key,
// resolved by detail.resolve.
export const hashKeysOf = ({ hashKey, hashKeys, resolve } = {}) =>
    hashKeys ?? { [typeof hashKey === 'string' ? hashKey : 'id']: resolve };

// the first of `keys` the hash carries, as [key, id]
export const readHashKeys = (hash, keys) =>
    keys.map(k => [k, getHashParam(hash, k)]).find(([, id]) => id != null) ?? [];

// write the id under one key and drop the app's others, so a link written in
// an alias does not outlive the selection it named (no key clears them all)
export const writeHashKeys = (hash, keys, key, id) =>
    keys.reduce((h, k) => setHashParam(h, k, k === key ? id : null), hash);
