// the review api: a person's verdict on one published attribution. the page
// at /review writes one; the jump host reads them all every quarter hour and
// folds them into the table's `verified` and `verify_notes`. a write needs a
// cloudflare access login, checked here as well as at the edge, so a dropped
// path rule cannot open it. reads are open: a verdict is public within the
// quarter hour anyway, and the host reads with no credential at all.
const TEAM = 'https://datadesk.cloudflareaccess.com'
// `open` takes a verdict back: the claim awaits review again
const VERDICTS = ['confirmed', 'refuted', 'unclear', 'open']
const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')),
  c => c.charCodeAt(0))
const json = s => JSON.parse(new TextDecoder().decode(b64(s)))
let certs

async function who(req) {
  const jwt = req.headers.get('cf-access-jwt-assertion')
  if (!jwt) return
  const [h, p, s] = jwt.split('.'), { kid } = json(h)
  certs ??= fetch(TEAM + '/cdn-cgi/access/certs').then(r => r.json())
  const jwk = (await certs).keys.find(k => k.kid === kid)
  if (!jwk) return void (certs = null)
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
  const key = await crypto.subtle.importKey('jwk', jwk, alg, false, ['verify'])
  const ok = await crypto.subtle.verify(alg, key, b64(s),
    new TextEncoder().encode(h + '.' + p))
  const c = json(p)
  if (ok && c.iss === TEAM && c.exp > Date.now() / 1000
      && c.email?.endsWith('@datadesk.eco')) return c.email
}

export default {
  async fetch(req, env) {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('select * from decision').all()
      return Response.json(results)
    }
    if (req.method !== 'POST') return new Response(null, { status: 405 })
    const by = await who(req).catch(() => {})
    if (!by) return new Response('a data desk access login is needed',
      { status: 403 })
    const { id, run_at, verdict, notes } = await req.json()
    if (!id || !run_at || !VERDICTS.includes(verdict))
      return new Response('id, run_at and a verdict are needed', { status: 400 })
    await env.DB.prepare('insert or replace into decision values (?, ?, ?, ?, ?,'
      + " strftime('%Y-%m-%dT%H:%M:%SZ'))")
      .bind(id, run_at, verdict, notes || null, by).run()
    return new Response(null, { status: 204 })
  }
}
