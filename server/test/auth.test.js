// SSO WordPress : tout ce qui est vérifiable sans WordPress (redirection PKCE, cookies signés, refus).
// Le dernier tronçon (connexion réelle à WordPress) ne se teste qu'à la main.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { startServer } from './harness.js'

const SECRET = 'a'.repeat(64)
const PUBLIC_URL = 'http://localhost:5173'
let srv

const b64u = (b) => Buffer.from(b).toString('base64url')
const sign = (payload, secret = SECRET) => {
  const body = b64u(JSON.stringify(payload))
  return `${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`
}
const session = (extra = {}, secret) => sign({ sub: 1, name: 'Test', email: 't@t.fr', roles: ['admin'], exp: Date.now() / 1000 + 60, ...extra }, secret)
const get = (path, cookie, opts = {}) => fetch(srv.base + path, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {}, ...opts })

before(async () => {
  // WP_URL pointe vers un port fermé : l'échange du code échoue vite et de façon déterministe.
  srv = await startServer({ WP_URL: 'http://127.0.0.1:1', WP_CLIENT_ID: 'testclient', SESSION_SECRET: SECRET, PUBLIC_URL, ADMIN_PASSWORD: 'pw' })
})
after(() => srv?.stop())

test('SSO actif : le mot de passe ne donne plus accès', async () => {
  assert.deepEqual(await (await get('/api/auth/config')).json(), { sso: true })
  assert.equal((await get('/api/creations')).status, 401)
  assert.equal((await get('/api/creations', null, { headers: { Authorization: 'Bearer pw' } })).status, 401)
  assert.equal((await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"pw"}' })).status, 404)
})

test('login : redirection vers WordPress avec un défi PKCE S256 cohérent avec le verifier du cookie', async () => {
  const res = await get('/api/auth/login')
  assert.equal(res.status, 302)
  const loc = new URL(res.headers.get('location'))
  assert.equal(loc.origin + loc.pathname, 'http://127.0.0.1:1/oauth/authorize/')
  const p = loc.searchParams
  assert.equal(p.get('response_type'), 'code')
  assert.equal(p.get('client_id'), 'testclient')
  assert.equal(p.get('redirect_uri'), `${PUBLIC_URL}/api/auth/callback`)
  assert.equal(p.get('code_challenge_method'), 'S256')

  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('eink_oauth='))
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  const payload = JSON.parse(Buffer.from(decodeURIComponent(cookie.split('=')[1].split(';')[0]).split('.')[0], 'base64url'))
  assert.equal(payload.state, p.get('state'))
  assert.equal(createHash('sha256').update(payload.verifier).digest('base64url'), p.get('code_challenge'))
  assert.ok(payload.verifier.length >= 43, 'verifier PKCE >= 43 caractères (RFC 7636)')
})

test('callback : état invalide ou absent refusé ; échec de WordPress géré proprement', async () => {
  const loc = async (res) => res.headers.get('location')
  assert.equal(await loc(await get('/api/auth/callback?code=x&state=y')), `${PUBLIC_URL}/?auth_error=state`)

  const login = await get('/api/auth/login')
  const state = new URL(login.headers.get('location')).searchParams.get('state')
  const oauth = login.headers.getSetCookie().find((c) => c.startsWith('eink_oauth=')).split(';')[0]
  assert.equal(await loc(await get(`/api/auth/callback?code=x&state=mauvais`, oauth)), `${PUBLIC_URL}/?auth_error=state`)
  assert.equal(await loc(await get(`/api/auth/callback?code=x&state=${state}`, oauth)), `${PUBLIC_URL}/?auth_error=exchange`)
})

test('cookie de session : valide accepté, tout le reste refusé', async () => {
  const ok = await get('/api/creations', `eink_session=${session()}`)
  assert.equal(ok.status, 200)
  assert.equal((await (await get('/api/auth/me', `eink_session=${session()}`)).json()).user.name, 'Test')

  const good = session()
  const [body, sig] = good.split('.')
  const forged = b64u(JSON.stringify({ sub: 999, name: 'Pirate', roles: ['admin'], exp: Date.now() / 1000 + 60 }))
  const cases = {
    expiré: session({ exp: Date.now() / 1000 - 5 }),
    'signature altérée': `${body}.${sig.slice(0, -2)}AA`,
    'contenu modifié, signature conservée': `${forged}.${sig}`,
    'signé avec un autre secret': session({}, 'b'.repeat(64)),
    'sans signature': body,
    'n’importe quoi': 'x.y',
  }
  for (const [name, cookie] of Object.entries(cases)) {
    assert.equal((await get('/api/creations', `eink_session=${cookie}`)).status, 401, name)
  }
})

test('logout : le cookie de session est supprimé', async () => {
  const res = await fetch(srv.base + '/api/auth/logout', { method: 'POST' })
  const c = res.headers.getSetCookie().find((x) => x.startsWith('eink_session='))
  assert.match(c, /Max-Age=0/)
})
