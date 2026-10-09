// the engine's client, in a worker of its own: duckdb-wasm runs its
// statements in a worker already, but hands back arrow tables, and turning
// those into rows is the main thread's share of a read (~0.5 s for the flare
// archive). here it is nobody's: data.js posts a statement and gets rows.
// messages are [seq, op, ...args] in and [seq, value, error] out.
const DDB = new URL('../vendor/duckdb/', import.meta.url).href;
const DUCKDB_RELEASE = 'v2.0.0-alpha1-lite.5';
const duckdbAsset = name => `${DDB}${name}?v=${DUCKDB_RELEASE}`;

const db = (async () => {
    const d = await import(duckdbAsset('duckdb-browser.mjs'));
    const worker = new Worker(duckdbAsset('duckdb-browser-eh.worker.js'));
    const db = new d.AsyncDuckDB(new d.VoidLogger(), worker);
    await db.instantiate(duckdbAsset('duckdb-eh.wasm'));
    return db;
})();

// a connection per lane. the engine runs one connection's statements in turn
// and overlaps different connections' reads, so a lane is "may wait behind
// itself, never behind anything else": a card open cannot hold a pan.
const lanes = new Map();
const connect = (lane = 'map') => {
    if (!lanes.has(lane)) lanes.set(lane, db.then(d => d.connect()));
    return lanes.get(lane);
};

const OPS = {
    ready: async () => { await connect(); },
    register: async (name, bytes) =>
        void await (await db).registerFileBuffer(name, bytes),
    sql: async (statement, lane) => {
        const result = await (await connect(lane)).query(statement);
        return rows(result, result.schema.fields);
    },
};
onmessage = async ({ data: [seq, op, ...args] }) => {
    try { postMessage([seq, await OPS[op](...args)]); }
    catch (err) { postMessage([seq, null, String(err?.message ?? err)]); }
};

// column by column, not through row proxies: each field's vector is walked
// once, and a list of structs the same way. an iterated vector yields null
// where invalid
const rows = (vec, fields) => {
    const cols = fields.map(f => [f.name,
        Array.from(vec.getChild(f.name), v => value(v, f.type))]);
    return Array.from({ length: vec.length ?? vec.numRows }, (_, i) => {
        const out = {};
        for (const [k, c] of cols) out[k] = c[i];
        return out;
    });
};

const day = ms => new Date(Number(ms)).toISOString()
    .replace('T00:00:00.000Z', '');
const value = (item, type) => item == null ? item
    : type.typeId === 8 ? day(item)
    : type.typeId === 10 ? new Date(Number(item)).toISOString()
    : type.typeId === 12 ? (type.children[0].type.typeId === 13
        ? rows(item, type.children[0].type.children)
        : Array.from(item, child => value(child, type.children[0].type)))
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
