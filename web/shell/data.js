// one lazy duckdb-wasm engine serves every parquet read and raw statement.
// it runs in its own worker, so nothing here needs one.
const DDB = new URL('../vendor/duckdb/', import.meta.url).href;
const DUCKDB_RELEASE = 'v2.0.0-alpha1-lite.5';
const duckdbAsset = name => `${DDB}${name}?v=${DUCKDB_RELEASE}`;

let files = {}, engine;
const lanes = new Map();

// the engine is ~7 MB over the wire, so it starts here, downloading while
// the map loads its style and tiles rather than after
export function initData({ files: f = {}, prefetch = [] } = {}) {
    files = f;
    connect().catch(() => {});
    for (const name of prefetch) prefetchData(name);
}

const db = () => engine ??= (async () => {
    const d = await import(duckdbAsset('duckdb-browser.mjs'));
    const worker = new Worker(duckdbAsset('duckdb-browser-eh.worker.js'));
    const db = new d.AsyncDuckDB(new d.VoidLogger(), worker);
    await db.instantiate(duckdbAsset('duckdb-eh.wasm'));
    return db;
})();

// a connection per lane. the engine runs one connection's statements in turn
// and overlaps different connections' reads, so a lane is "may wait behind
// itself, never behind anything else": a card open cannot hold a pan.
const connect = (lane = 'map') => {
    if (!lanes.has(lane)) lanes.set(lane, db().then(d => d.connect()));
    return lanes.get(lane);
};

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
        await (await db()).registerFileBuffer(buf, bytes);
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

// the schema is read once, not per row: a viewport returns tens of thousands
export async function sql(statement, { lane } = {}) {
    const result = await (await connect(lane)).query(statement);
    const fields = result.schema.fields;
    return result.toArray().map(row => {
        const out = {};
        for (const f of fields) out[f.name] = value(row[f.name], f.type);
        return out;
    });
}

const day = ms => new Date(Number(ms)).toISOString()
    .replace('T00:00:00.000Z', '');
const value = (item, type) => item == null ? item
    : type.typeId === 8 ? day(item)
    : type.typeId === 10 ? new Date(Number(item)).toISOString()
    : type.typeId === 12
        ? Array.from(item, child => value(child, type.children[0].type))
    : type.typeId === 13 ? Object.fromEntries(type.children
        .map(c => [c.name, value(item[c.name], c.type)]))
    : norm(item);

// bigints to numbers and dates to iso strings, through lists and structs,
// leaving typed arrays alone
const norm = v => typeof v === 'bigint' ? Number(v)
    : v instanceof Date ? day(v)
    : Array.isArray(v) ? v.map(norm)
    : v && typeof v === 'object' && !ArrayBuffer.isView(v)
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
    : v;

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
