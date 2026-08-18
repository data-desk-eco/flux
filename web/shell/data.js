// one lazy duckdb-wasm engine serves every parquet read, table metadata and raw
// SQL. duckdb runs in its own worker, so nothing here needs a worker or a decode
// library of its own.
const DDB = new URL('../vendor/duckdb/', import.meta.url).href;
const DUCKDB_RELEASE = 'v2.0.0-alpha1-lite.5';
const duckdbAsset = name => `${DDB}${name}?v=${DUCKDB_RELEASE}`;

let files = {}, base, engine;
const lanes = new Map();
const metadata = new Map();

// the engine is ~7 MB over the wire, so start it here rather than on the first
// read: it then downloads and compiles while the map loads its own style and
// tiles, instead of after.
export function initData({ files: f = {}, prefetch = [], base: b } = {}) {
    files = f;
    base = b ?? globalThis.location?.href;
    connect().catch(() => {});
    for (const name of prefetch) prefetchData(name);
}

async function db() {
    if (!engine) engine = (async () => {
        const d = await import(duckdbAsset('duckdb-browser.mjs'));
        const worker = new Worker(duckdbAsset('duckdb-browser-eh.worker.js'));
        const db = new d.AsyncDuckDB(new d.VoidLogger(), worker);
        await db.instantiate(duckdbAsset('duckdb-eh.wasm'));
        return db;
    })();
    return engine;
}
// one connection per lane. the engine runs a connection's statements one at a
// time and overlaps the reads of different connections, so a lane is the unit of
// "may wait behind itself, must not wait behind anything else". the map is one
// lane; a card opening over the big detections objects is another, so opening a
// card cannot hold a pan behind it.
const connect = (lane = 'map') => {
    if (!lanes.has(lane)) lanes.set(lane, db().then(d => d.connect()));
    return lanes.get(lane);
};

// an object small enough to hold is fetched whole here — a plain parallel GET,
// off the statement queue, overlapping the engine download — and registered as
// an engine buffer, so every statement over it runs at memory speed instead of
// paying the open-probe-footer round trips per statement and the same ranges
// again per viewport. measured on a cold load, this is what took the first
// points from ~4.7 s to ~2.2 s and the full three layers from ~6.4 s to ~3.2 s.
// an object past the cap, a failed fetch, or a server that will not say its
// size all fall back to the url and the ranged read they were getting anyway —
// which is the right tier for what is too big to hold (data-desk/detections,
// the partitioned eog/detections).
const PREFETCH_CAP = 8 << 20;
const buffers = new Map();
let bufSeq = 0;
export function prefetchData(name) {
    const u = url(name);
    if (!buffers.has(u)) buffers.set(u, (async () => {
        const res = await fetch(u);
        const size = +res.headers.get('content-length');
        if (!res.ok || !(size <= PREFETCH_CAP)) { res.body?.cancel(); return null; }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const buf = `prefetch${bufSeq++}.parquet`;
        await (await db()).registerFileBuffer(buf, bytes);
        return buf;
    })().catch(() => null));
    return buffers.get(u);
}
// a read of a prefetched object waits for its buffer rather than racing it to
// the network; anything else (and any prefetch that fell back) keeps its url
const viaBuffer = async source => Array.isArray(source)
    ? Promise.all(source.map(viaBuffer))
    : (buffers.has(source) ? await buffers.get(source) : null) ?? source;

const quote = value => {
    if (value instanceof Date) value = value.toISOString();
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    throw new TypeError(`Unsupported SQL value: ${value}`);
};
const ident = name => `"${String(name).replaceAll('"', '""')}"`;
const url = name => {
    if (Array.isArray(name)) return name.map(url);
    const value = files[name] ?? name;
    if (Array.isArray(value)) return value.map(url);
    // always canonicalised, so a prefetch at page parse and a read after
    // initData key the buffers map with one spelling of one object
    return new URL(value, base ?? globalThis.location?.href).href;
};
const list = source => Array.isArray(source) ? `[${source.map(quote).join(', ')}]` : quote(source);
export const parquetInput = name => list(url(name));

// only the rows a query keeps are normalised — read()'s predicates are SQL, so
// the engine has discarded the rest before this point — and the schema is read
// once rather than rebuilt per row: a viewport read returns tens of thousands.
export async function sql(statement, { lane } = {}) {
    const result = await (await connect(lane)).query(statement);
    const fields = result.schema.fields;
    return result.toArray().map(row => {
        const out = {};
        for (const field of fields) out[field.name] = value(row[field.name], field.type);
        return out;
    });
}

const value = (item, type) => {
    if (item == null) return item;
    if (type.typeId === 8) return new Date(Number(item)).toISOString()
        .replace('T00:00:00.000Z', '');
    if (type.typeId === 10) return new Date(Number(item)).toISOString();
    if (type.typeId === 12) return Array.from(item,
        child => value(child, type.children[0].type));
    if (type.typeId === 13) return Object.fromEntries(type.children
        .map(child => [child.name, value(item[child.name], child.type)]));
    return norm(item);
};

export async function read(name, { columns, where, lane } = {}) {
    const select = columns?.length ? columns.map(ident).join(', ') : '*';
    const tests = Object.entries(where ?? {}).flatMap(([column, [lo, hi]]) => {
        const col = ident(column);
        return [`${col} IS NOT NULL`, ...(lo == null ? [] : [`${col} >= ${quote(lo)}`]),
            ...(hi == null ? [] : [`${col} <= ${quote(hi)}`])];
    });
    const source = await viaBuffer(url(name));
    const options = Array.isArray(source) ? ', union_by_name = true' : '';
    return sql(`SELECT ${select} FROM read_parquet(${list(source)}${options})${tests.length ? ` WHERE ${tests.join(' AND ')}` : ''}`, { lane });
}

// the footer shape a caller inspecting row-group bounds expects: duckdb reads
// the parquet footer and returns one metadata row per column.
export function meta(name) {
    const source = url(name);
    if (!metadata.has(source)) metadata.set(source, sql(`
        SELECT row_group_id, row_group_num_rows, path_in_schema, type,
               stats_min_value, stats_max_value
        FROM parquet_metadata(${quote(source)})
        ORDER BY row_group_id, column_id
    `).then(rows => {
        const groups = [];
        for (const row of rows) {
            const group = groups[row.row_group_id] ??= { num_rows: row.row_group_num_rows, columns: [] };
            group.columns.push({ meta_data: {
                path_in_schema: row.path_in_schema.split(', '),
                statistics: {
                    min_value: stat(row.stats_min_value, row.type),
                    max_value: stat(row.stats_max_value, row.type),
                },
            }});
        }
        return { row_groups: groups };
    }));
    return metadata.get(source);
}

const stat = (value, type) => value == null ? null
    : type === 'BOOLEAN' ? value === 'true'
    : /^(U?INT|HUGEINT|FLOAT|DOUBLE|DECIMAL)/.test(type)
        && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value) ? Number(value)
    : value;

// bigints become numbers and dates become ISO strings, recursing through nested
// lists and structs but leaving typed arrays alone.
export const norm = value =>
    typeof value === 'bigint' ? Number(value)
    : value instanceof Date ? value.toISOString().replace('T00:00:00.000Z', '')
    : Array.isArray(value) ? value.map(norm)
    : value && typeof value === 'object' && !ArrayBuffer.isView(value)
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, norm(item)]))
    : value;

export function fc(rows, { lat = 'lat', lon = 'lon' } = {}) {
    return { type: 'FeatureCollection', features: rows.map(properties => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [properties[lon], properties[lat]] },
        properties,
    })) };
}
