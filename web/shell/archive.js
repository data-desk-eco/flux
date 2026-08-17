// the archive publishes what it contains. <base>/index.json is one small object
// mapping table -> provider -> the partition key that provider's table is
// addressed by, or null when it is a single data.parquet:
//
//   <base>/<provider>/<table>/data.parquet                   key null
//   <base>/<provider>/<table>/<key>=<value>/data.parquet     key named
//
// a map fetches it once and then names exact objects. that is what removes the
// three things a cross-provider read used to need: a glob whose wildcard is the
// first path segment (no literal prefix to narrow on, so the browser paginates
// the whole bucket before reading a byte), a single read_parquet([...]) over
// enumerated urls (one missing object fails all of them), and a provider list
// written into the app.
//
// json rather than parquet so the fetch overlaps the ~6 MB duckdb download
// instead of queueing behind it — and so curl, jq and read_json see it too.

let base, doc;

// fetch the index once. idempotent, independent of the duckdb connection, and
// safe to call at module parse. returns the document.
export function initArchive(url) {
    base = String(url).replace(/\/+$/, '');
    return doc ??= fetch(`${base}/index.json`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`archive index: HTTP ${r.status}`)))
        .catch(err => { doc = null; throw err; });
}

// every object of `table` the caller can name: one url per provider that
// publishes it whole, plus each partitioned provider addressed at `key` — the
// partition value, which a reader computes from a position or carries on a row.
// a partitioned provider is left out when no key is given, because an https url
// cannot expand a glob and a table too big to name is not one to read whole.
//
// urls, not rows: the caller keeps its own Promise.allSettled, so a provider
// that has not published costs its own rows and nothing else.
export async function objects(table, { key, provider } = {}) {
    // through initArchive, not the memo: a fetch that failed cleared it, and
    // reading the cleared memo reported "call initArchive first" for what was
    // really an HTTP 503. going back through it says what went wrong and retries.
    if (!base) throw new Error('archive: call initArchive(base) first');
    return Object.entries((await initArchive(base))[table] ?? {})
        .filter(([p, part]) => (!provider || p === provider) && (!part || key != null))
        .map(([p, part]) => `${base}/${p}/${table}/${part ? `${part}=${key}/` : ''}data.parquet`);
}
