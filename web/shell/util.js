// shared helpers: formatting, geometry, quarters and permalinks. no dom, so
// node can test what reads them.

const ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
                 "'": '&#39;' };
export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ENTITY[c]);

// the spelling of a detection id that survives the archive's namespacing
// (`c096…` became `IMEO:c096…`): what an old permalink and the attributions
// join read on, since neither moves in step with the detections objects
export const canon = id => String(id).toLowerCase().replace(/_/g, ':')
    .replace(/^[a-z]+:/, '');

const rad = d => d * Math.PI / 180;
export function haversineM(lat1, lon1, lat2, lon2) {
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1))
        * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

// metres -> degrees; the cos floor keeps a span finite at the poles
export const degLat = m => m / 111320;
export const degLon = (m, lat) =>
    m / (111320 * Math.max(0.05, Math.cos(rad(lat))));

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = deg => deg == null || isNaN(deg) ? ''
    : COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

export const fmtMetres = m => m == null ? '?'
    : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

export const fmtCoords = (lat, lon) =>
    `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, `
    + `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;

export function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} `
        + d.getFullYear();
}

// grow a bbox to at least `min` degrees an axis, so availability over a
// razor-thin viewport reflects the area rather than flipping between features
export function padBbox([w, s, e, n], min = 0.03) {
    const dw = Math.max(0, (min - (e - w)) / 2);
    const dh = Math.max(0, (min - (n - s)) / 2);
    return [w - dw, s - dh, e + dw, n + dh];
}

// quarters are keyed "2025_3"

const pad2 = n => String(n).padStart(2, '0');

// {startDate, endDate} spanning the keys, or null for none
export function quarterRange(keys) {
    let start = null, end = null;
    for (const k of keys) {
        const [y, q] = String(k).split('_').map(Number);
        const s = `${y}-${pad2(q * 3 - 2)}-01`;
        const e = `${y}-${pad2(q * 3)}-${new Date(y, q * 3, 0).getDate()}`;
        if (!start || s < start) start = s;
        if (!end || e > end) end = e;
    }
    return start ? { startDate: start, endDate: end } : null;
}

export const quarterOf = d =>
    `${d.slice(0, 4)}_${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;

// an empty set is no window, and admits every date
export const dateInQuarters = (d, keys) =>
    !keys.size || keys.has(quarterOf(d));

// #<key>=<id> permalinks, beside maplibre's #map=

const hashParam = (hash, key) => {
    const m = hash.match(new RegExp(`${key}=([^&]*)`));
    return m ? decodeURIComponent(m[1]) : null;
};

// the first of `keys` the hash carries, as [key, id]
export const readHashKeys = (hash, keys) => keys
    .map(k => [k, hashParam(hash, k)]).find(([, id]) => id != null) ?? [];

// the id under `key`, and none of the other keys, so a link written in an
// alias does not outlive its selection (no key clears them all)
export function writeHashKeys(hash, keys, key, id) {
    const rest = hash.replace(/^#/, '').split('&')
        .filter(p => p && !keys.some(k => p.startsWith(`${k}=`)));
    if (key && id != null) rest.push(`${key}=${encodeURIComponent(id)}`);
    return rest.length ? '#' + rest.join('&') : '';
}

// run fn once calls stop arriving for ms
export const debounce = (fn, ms) => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
};
