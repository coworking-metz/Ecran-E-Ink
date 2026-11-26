// SSO admin via le WordPress du coworking (serveur OAuth2 « WP OAuth Server »).
// Flux : Authorization Code + PKCE (S256), client PUBLIC (aucun secret client). Tout se passe côté serveur :
// les jetons WordPress ne vont jamais dans le navigateur, qui ne reçoit qu'un cookie de session signé.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const WP_URL = (process.env.WP_URL || '').replace(/\/$/, '')
const CLIENT_ID = process.env.WP_CLIENT_ID || ''
const SESSION_SECRET = process.env.SESSION_SECRET || ''
// URL publique de l'admin (celle que le navigateur voit : Vite en dev, le serveur en prod).
// redirect_uri = PUBLIC_URL + /api/auth/callback, à enregistrer côté WordPress.
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '')
const ALLOWED_ROLES = (process.env.SSO_ALLOWED_ROLES || 'admin').split(',').map((s) => s.trim()).filter(Boolean)
const SESSION_SECONDS = Number(process.env.SESSION_DAYS || 7) * 86400

const REDIRECT_URI = `${PUBLIC_URL}/api/auth/callback`
const SECURE = PUBLIC_URL.startsWith('https://')
export const SSO_ENABLED = !!(WP_URL && CLIENT_ID && SESSION_SECRET)
export const SSO_PARTIAL = !SSO_ENABLED && !!(WP_URL || CLIENT_ID || SESSION_SECRET)

// ---------- cookies signés ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url')
const mac = (data) => createHmac('sha256', SESSION_SECRET).update(data).digest()

const sign = (payload) => {
  const body = b64u(JSON.stringify(payload))
  return `${body}.${b64u(mac(body))}`
}
const unsign = (token) => {
  if (!SESSION_SECRET || typeof token !== 'string') return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = mac(body)
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString())
    return p.exp > Date.now() / 1000 ? p : null
  } catch { return null }
}

const parseCookies = (header = '') =>
  Object.fromEntries(header.split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
    const i = c.indexOf('=')
    return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]
  }))
const cookie = (name, value, { maxAge, path = '/' }) =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`

export const sessionUser = (req) => {
  if (!SSO_ENABLED) return null
  const p = unsign(parseCookies(req.headers.cookie).eink_session)
  return p ? { id: p.sub, name: p.name, email: p.email, roles: p.roles } : null
}

// Droit d'accès : un des rôles autorisés (par défaut « admin », calculé par le WordPress du coworking),
// ou administrateur WordPress si « admin » est autorisé.
const isAllowed = (me) => {
  const roles = [...(me.roles ?? [])]
  if ((me.user_roles ?? []).includes('administrator')) roles.push('admin')
  return roles.some((r) => ALLOWED_ROLES.includes(r))
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export function registerAuth(app) {
  app.get('/api/auth/config', async () => ({ sso: SSO_ENABLED }))

  app.get('/api/auth/me', async (req, reply) => {
    const user = sessionUser(req)
    return user ? { user } : reply.code(401).send({ error: 'unauthorized' })
  })

  app.post('/api/auth/logout', async (req, reply) => {
    reply.header('Set-Cookie', cookie('eink_session', '', { maxAge: 0 }))
    return { ok: true }
  })

  if (!SSO_ENABLED) return

  // 1) Redirige vers WordPress avec un état aléatoire et un défi PKCE ; verifier + state restent dans un cookie signé.
  app.get('/api/auth/login', async (req, reply) => {
    const state = randomBytes(16).toString('hex')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    reply.header('Set-Cookie', cookie('eink_oauth', sign({ state, verifier, exp: Date.now() / 1000 + 600 }), { maxAge: 600, path: '/api/auth' }))
    const url = new URL(`${WP_URL}/oauth/authorize/`)
    url.search = new URLSearchParams({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state,
      code_challenge: challenge, code_challenge_method: 'S256',
    }).toString()
    return reply.redirect(url.toString())
  })

  // 2) Retour de WordPress : vérifie l'état, échange le code (avec le verifier, sans secret), lit l'utilisateur, ouvre la session.
  app.get('/api/auth/callback', async (req, reply) => {
    const fail = (code) => {
      reply.header('Set-Cookie', cookie('eink_oauth', '', { maxAge: 0, path: '/api/auth' }))
      return reply.redirect(`${PUBLIC_URL}/?auth_error=${code}`)
    }
    const saved = unsign(parseCookies(req.headers.cookie).eink_oauth)
    const { code, state, error } = req.query ?? {}
    if (error) return fail('denied')
    if (!saved || !code || !state || !safeEq(state, saved.state)) return fail('state')

    let token
    try {
      const res = await fetch(`${WP_URL}/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: saved.verifier }),
        signal: AbortSignal.timeout(10_000),
      })
      token = (await res.json()).access_token
    } catch (e) { req.log.error({ err: e }, 'sso: échange du code impossible') }
    if (!token) return fail('exchange')

    let me
    try {
      const res = await fetch(`${WP_URL}/oauth/me/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
      me = await res.json()
    } catch (e) { req.log.error({ err: e }, 'sso: lecture du profil impossible') }
    if (!me?.ID) return fail('userinfo')
    if (!isAllowed(me)) { req.log.warn({ user: me.ID }, 'sso: compte sans droit admin'); return fail('forbidden') }

    const session = sign({
      sub: me.ID, name: me.display_name || me.user_login, email: me.user_email, roles: me.roles ?? [],
      exp: Date.now() / 1000 + SESSION_SECONDS,
    })
    reply.header('Set-Cookie', [
      cookie('eink_session', session, { maxAge: SESSION_SECONDS }),
      cookie('eink_oauth', '', { maxAge: 0, path: '/api/auth' }),
    ])
    return reply.redirect(`${PUBLIC_URL}/`)
  })
}
