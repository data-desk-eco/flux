// the archive publishes what it contains. <base>/index.json maps table ->
// provider -> the partition key that provider's table is addressed by, or
// null when it is one data.parquet:
//
//   <base>/<provider>/<table>/data.parquet                   key null
//   <base>/<provider>/<table>/<key>=<value>/data.parquet     key named
//
// so a reader names exact objects: no bucket-wide glob, no one read that a
// missing object fails, no provider list in the app. json, not parquet, so
// the fetch overlaps the engine download.

let base, doc;

// fetch the index once; safe at module parse. a failure clears the memo
export function initArchive(url) {
    base = String(url).replace(/\/+$/, '');
    return doc ??= fetch(`${base}/index.json`)
        .then(r => r.ok ? r.json()
            : Promise.reject(new Error(`archive index: HTTP ${r.status}`)))
        .catch(err => { doc = null; throw err; });
}

// the urls of `table`: one per provider publishing it whole, plus each
// partitioned one addressed at `key`. a partitioned provider is left out with
// no key, as a url cannot expand a glob. urls, not rows, so a provider that
// has not published costs the caller its own rows alone.
export async function objects(table, { key, provider } = {}) {
    // through initArchive, not the memo, so a failed fetch retries and says
    // what went wrong rather than "call initArchive first"
    if (!base) throw new Error('archive: call initArchive(base) first');
    return Object.entries((await initArchive(base))[table] ?? {})
        .filter(([p, part]) =>
            (!provider || p === provider) && (!part || key != null))
        .map(([p, part]) => `${base}/${p}/${table}/`
            + `${part ? `${part}=${key}/` : ''}data.parquet`);
}
