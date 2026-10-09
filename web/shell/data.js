// one lazy duckdb-wasm engine serves every parquet read and raw statement.
// its client runs in engine.js, a worker, so a read costs the main thread
// only the structured clone of its rows.
let files = {}, engine, seq = 0;
const pending = new Map();

const db = () => engine ??= (() => {
    const w = new Worker(new URL('./engine.js', import.meta.url),
        { type: 'module' });
    w.onmessage = ({ data: [n, v, err] }) => {
        const [ok, fail] = pending.get(n);
        pending.delete(n);
        err == null ? ok(v) : fail(new Error(err));
    };
    return w;
})();
const call = (op, args, transfer = []) => new Promise((ok, fail) => {
    pending.set(++seq, [ok, fail]);
    db().postMessage([seq, op, ...args], transfer);
});

// the engine is ~7 MB over the wire, so it starts here, downloading while
// the map loads its style and tiles rather than after
export function initData({ files: f = {}, prefetch = [] } = {}) {
    files = f;
    call('ready', []).catch(() => {});
    for (const name of prefetch) prefetchData(name);
}

// an object small enough to hold is fetched whole, racing the engine
// download, and registered as an engine buffer, so every statement over it
// runs at memory speed (cold first points ~4.7 s -> ~2.2 s). past the cap, a
// failed fetch, or no stated size, and it falls back to its url and the
// ranged read it would have had anyway.
const PREFETCH_CAP = 8 << 20;
const buffers = new Map();
let bufSeq = 0;
export function prefetchData(name) {
    const u = url(name);
    if (!buffers.has(u)) buffers.set(u, (async () => {
        const res = await fetch(u);
        const size = +res.headers.get('content-length');
        if (!res.ok || !(size <= PREFETCH_CAP)) {
            res.body?.cancel();
            return null;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const buf = `prefetch${bufSeq++}.parquet`;
        await call('register', [buf, bytes], [bytes.buffer]);
        return buf;
    })().catch(() => null));
    return buffers.get(u);
}
// a read of a prefetched object waits for its buffer, not the network
const viaBuffer = async source => Array.isArray(source)
    ? Promise.all(source.map(viaBuffer))
    : (buffers.has(source) ? await buffers.get(source) : null) ?? source;

// a reopened card asks for rows this session already parsed from an object
// too big to prefetch. the promise is held, bounded at an estimated 30 MB and
// evicting least recently used, so two askers share a read and a failed read
// is not held. the rows are shared: read them, never write them.
const MEMO_BUDGET = 30 << 20;
const ROW_COST = 200;   // bytes, roughly, for a small flat row in v8
const memo = new Map();
let memoBytes = 0;
export function memoised(key, run) {
    const hit = memo.get(key);
    if (hit) {   // touched, so newest last
        memo.delete(key);
        memo.set(key, hit);
        return hit.rows;
    }
    const entry = { bytes: 0 };
    entry.rows = run().then(rows => {
        memoBytes += entry.bytes = rows.length * ROW_COST;
        for (const [k, held] of memo) {   // insertion order: oldest first
            if (memoBytes <= MEMO_BUDGET) break;
            memoBytes -= held.bytes;
            memo.delete(k);
        }
        return rows;
    }, err => { memo.delete(key); throw err; });
    memo.set(key, entry);
    return entry.rows;
}

const quote = v => {
    if (v instanceof Date) v = v.toISOString();
    if (typeof v === 'string') return `'${v.replaceAll("'", "''")}'`;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'bigint' || Number.isFinite(v)) return String(v);
    throw new TypeError(`Unsupported SQL value: ${v}`);
};
const ident = name => `"${String(name).replaceAll('"', '""')}"`;
// canonical, so a prefetch and a later read key one object one way
const url = name => {
    if (Array.isArray(name)) return name.map(url);
    const value = files[name] ?? name;
    return Array.isArray(value) ? value.map(url)
        : new URL(value, globalThis.location?.href).href;
};
const list = s => Array.isArray(s) ? `[${s.map(quote).join(', ')}]` : quote(s);
export const parquetInput = name => list(url(name));

// a connection per lane (engine.js): a lane may wait behind itself, never
// behind anything else, so a card open cannot hold a pan
export const sql = (statement, { lane } = {}) =>
    call('sql', [statement, lane]);

// `where` is {column: [lo, hi]}, either end open, and never null
export async function read(name, { columns, where, lane } = {}) {
    const select = columns?.length ? columns.map(ident).join(', ') : '*';
    const tests = Object.entries(where ?? {}).flatMap(([column, [lo, hi]]) => {
        const col = ident(column);
        return [`${col} IS NOT NULL`,
            ...(lo == null ? [] : [`${col} >= ${quote(lo)}`]),
            ...(hi == null ? [] : [`${col} <= ${quote(hi)}`])];
    });
    const source = await viaBuffer(url(name));
    const union = Array.isArray(source) ? ', union_by_name = true' : '';
    const filter = tests.length ? ` WHERE ${tests.join(' AND ')}` : '';
    return sql(`SELECT ${select} FROM read_parquet(${list(source)}${union})`
        + filter, { lane });
}

export const fc = rows => ({ type: 'FeatureCollection',
    features: rows.map(properties => ({ type: 'Feature', properties,
        geometry: { type: 'Point',
                    coordinates: [properties.lon, properties.lat] } })) });
