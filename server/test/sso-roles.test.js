// SSO : seuls les administrateurs WordPress entrent. Un faux serveur OAuth (token + me) permet de tester le dernier
// tronçon de la connexion : échange du code avec PKCE, lecture du profil, contrôle du rôle, ouverture de session.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { startServer } from './harness.js'

const SECRET = 'c'.repeat(64)
const PUBLIC_URL = 'http://localhost:5173'
let wp, srv
const fake = { me: {}, tokenCalls: [], meCalls: 0 }

before(async () => {
  wp = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST' && req.url.startsWith('/oauth/token')) {
        fake.tokenCalls.push(Object.fromEntries(new URLSearchParams(body)))
        return res.end(JSON.stringify({ access_token: 'tok-123', token_type: 'Bearer' }))
      }
      if (req.url.startsWith('/oauth/me')) {
        fake.meCalls++
        if (req.headers.authorization !== 'Bearer tok-123') { res.statusCode = 400; return res.end('{"error":"invalid_request"}') }
        return res.end(JSON.stringify(fake.me))
      }
      res.statusCode = 404; res.end('{}')
    })
  })
  await new Promise((r) => wp.listen(0, '127.0.0.1', r))
  srv = await startServer({ WP_URL: `http://127.0.0.1:${wp.address().port}`, WP_CLIENT_ID: 'testclient', SESSION_SECRET: SECRET, PUBLIC_URL })
})
after(async () => { await srv?.stop(); await new Promise((r) => wp?.close(r)) })

const get = (path, cookie) => fetch(srv.base + path, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} })

// Déroule la connexion : /login (défi PKCE) puis /callback avec le profil que renverra le faux WordPress.
async function connect(me) {
  fake.me = me
  fake.tokenCalls.length = 0
  const login = await get('/api/auth/login')
  const authorize = new URL(login.headers.get('location'))
  const oauth = login.headers.getSetCookie().find((c) => c.startsWith('eink_oauth=')).split(';')[0]
  const cb = await get(`/api/auth/callback?code=le-code&state=${authorize.searchParams.get('state')}`, oauth)
  const session = cb.headers.getSetCookie().find((c) => c.startsWith('eink_session='))
  return { cb, session, authorize, location: cb.headers.get('location') }
}
const asCookie = (setCookie) => setCookie.split(';')[0]

const admin = { ID: 7, user_login: 'gilles', display_name: 'Gilles', user_email: 'g@example.com', user_roles: ['administrator'], roles: ['admin'] }

test('un administrateur WordPress entre : session ouverte, et l’API admin lui répond', async () => {
  const { location, session } = await connect(admin)
  assert.equal(location, `${PUBLIC_URL}/`)
  assert.ok(session, 'cookie de session posé')
  assert.equal((await get('/api/creations', asCookie(session))).status, 200)
  const me = await (await get('/api/auth/me', asCookie(session))).json()
  assert.equal(me.user.name, 'Gilles')
  assert.equal(me.user.email, 'g@example.com')
})

test('l’échange du code respecte PKCE : verifier cohérent avec le défi, client public (aucun secret), bonne redirect_uri', async () => {
  const { authorize } = await connect(admin)
  const [call] = fake.tokenCalls
  assert.equal(fake.tokenCalls.length, 1)
  assert.equal(call.grant_type, 'authorization_code')
  assert.equal(call.code, 'le-code')
  assert.equal(call.client_id, 'testclient')
  assert.equal(call.redirect_uri, `${PUBLIC_URL}/api/auth/callback`)
  assert.equal(createHash('sha256').update(call.code_verifier).digest('base64url'), authorize.searchParams.get('code_challenge'))
  assert.equal(call.client_secret, undefined, 'client public : aucun secret envoyé')
})

test('seuls les administrateurs WordPress sont admis : tous les autres profils sont refusés, sans session', async () => {
  const profiles = {
    abonné: { ID: 1, user_login: 'a', user_roles: ['subscriber'], roles: ['coworker'] },
    client: { ID: 2, user_login: 'b', user_roles: ['customer'], roles: [] },
    externe: { ID: 3, user_login: 'c', user_roles: ['externe'], roles: ['external'] },
    éditeur: { ID: 4, user_login: 'd', user_roles: ['editor'], roles: [] },
    'sans aucun rôle': { ID: 5, user_login: 'e', user_roles: [], roles: [] },
    // Le champ « admin » calculé par le site ne suffit PAS : seul le rôle WordPress compte.
    'rôle calculé « admin » sans être administrateur': { ID: 6, user_login: 'f', user_roles: ['subscriber'], roles: ['admin'] },
    'rôle calculé « admin » et user_roles absent': { ID: 8, user_login: 'g', roles: ['admin'] },
    'administrator mais dans un autre champ': { ID: 9, user_login: 'h', user_roles: [], roles: ['administrator'] },
    'rôle tapé en majuscules': { ID: 10, user_login: 'i', user_roles: ['Administrator'] },
    'user_roles de mauvais type': { ID: 11, user_login: 'j', user_roles: 'administrator' },
  }
  for (const [label, me] of Object.entries(profiles)) {
    const { location, session } = await connect(me)
    assert.equal(location, `${PUBLIC_URL}/?auth_error=forbidden`, label)
    assert.equal(session, undefined, `${label} : aucune session`)
  }
})

test('profil illisible ou sans identifiant : refusé', async () => {
  for (const me of [{}, { user_roles: ['administrator'] }, { ID: 0, user_roles: ['administrator'] }]) {
    const { location, session } = await connect(me)
    assert.equal(location, `${PUBLIC_URL}/?auth_error=userinfo`, JSON.stringify(me))
    assert.equal(session, undefined)
  }
})

test('la session dure 24 h au plus (un administrateur rétrogradé ne garde pas l’accès une semaine)', async () => {
  const { session } = await connect(admin)
  const maxAge = Number(/Max-Age=(\d+)/.exec(session)[1])
  assert.ok(maxAge <= 86400, `Max-Age = ${maxAge} s`)
  assert.ok(maxAge > 3600)
  assert.match(session, /HttpOnly/)
  assert.match(session, /SameSite=Lax/)
})
