// the export lng terminals a flare is named after, off gem's infrastructure
// table. on the card lane: a ranged read of a big object, which the first
// flare dot must not wait behind. a site drawn before it lands is renamed on
// the next refresh.

import { sql, parquetInput } from '../shell/data.js';
import { objects } from '../shell/archive.js';
import { setTerminals } from './clustering.js';

const query = u => `SELECT name, lat, lon FROM read_parquet(${parquetInput(u)})
    WHERE kind = 'lng_terminal' AND detail LIKE 'export%'
      AND status IN ('operating', 'construction', 'suspended')`;

export const loadTerminals = () =>
    objects('infrastructure', { provider: 'gem' })
        .then(([u]) => sql(query(u), { lane: 'card' }))
        .then(setTerminals)
        .catch(err => console.warn('terminals unavailable:', err));
