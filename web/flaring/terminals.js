// the export lng terminals a flare is named after, from gem's infrastructure
// table. on the card lane: it is a ranged read of a big object, and the first
// flare dot must not wait behind it. a site drawn before it lands is named by
// its count until the next refresh.

import { sql, parquetInput } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { setTerminals } from './clustering.js';

export const loadTerminals = () => objects('infrastructure', { provider: 'gem' })
    .then(([u]) => sql(`SELECT name, lat, lon FROM read_parquet(${parquetInput(u)})
        WHERE kind = 'lng_terminal' AND detail LIKE 'export%'
          AND status IN ('operating', 'construction', 'suspended')`,
        { lane: 'card' }))
    .then(setTerminals)
    .catch(err => console.warn('terminals unavailable, sites go unnamed:', err));
