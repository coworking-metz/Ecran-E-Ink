import { useEffect, useState } from 'react'
import { api, getPassword, setPassword } from './api.js'
import Creations from './Creations.jsx'
import Editor from './Editor.jsx'
import Devices from './Devices.jsx'
import Settings from './Settings.jsx'

const AUTH_ERRORS = {
  forbidden: "Ce compte n'a pas les droits d'administration de l'outil.",
  denied: 'Connexion annulée.',
  state: 'La connexion a expiré ou a été interrompue, réessaie.',
  exchange: 'Le site du coworking a refusé la connexion, réessaie.',
  userinfo: "Impossible de lire ton profil sur le site du coworking.",
}

function Login({ sso, onPasswordOk }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const authError = new URLSearchParams(location.search).get('auth_error')

  const submit = async (e) => {
    e.preventDefault()
    if (await api.login(pw)) {
      setPassword(pw)
      onPasswordOk()
    } else setErr(true)
  }

  return (
    <div className="login">
      <h1>E-ink Admin</h1>
      {sso ? (
        <>
          <a className="button primary" href="/api/auth/login">Se connecter avec le compte Coworking Metz</a>
          {authError && <p className="error">{AUTH_ERRORS[authError] ?? 'Connexion impossible.'}</p>}
        </>
      ) : (
        <form onSubmit={submit} className="login-form">
          <input type="password" placeholder="Mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          <button className="primary">Connexion</button>
          {err && <p className="error">Mot de passe incorrect</p>}
        </form>
      )}
    </div>
  )
}

const parseHash = () => {
  const [, page = 'creations', id] = location.hash.split('/')
  return { page, id: id ? Number(id) : null }
}

export default function App() {
  const [sso, setSso] = useState(false)
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // loading | in | out
  const [route, setRoute] = useState(parseHash())

  useEffect(() => {
    ;(async () => {
      const cfg = await api.authConfig().catch(() => ({ sso: false }))
      setSso(cfg.sso)
      if (cfg.sso) {
        const me = await api.me()
        setUser(me?.user ?? null)
        setStatus(me ? 'in' : 'out')
      } else setStatus(getPassword() ? 'in' : 'out')
    })()
    const onHash = () => setRoute(parseHash())
    const onUnauth = () => setStatus('out')
    window.addEventListener('hashchange', onHash)
    window.addEventListener('eink-unauthorized', onUnauth)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('eink-unauthorized', onUnauth)
    }
  }, [])

  const logout = async () => {
    setPassword('')
    if (sso) await api.logout()
    history.replaceState(null, '', location.pathname)
    setUser(null)
    setStatus('out')
  }

  if (status === 'loading') return null
  if (status === 'out') return <Login sso={sso} onPasswordOk={() => setStatus('in')} />

  if (route.page === 'editor' && route.id) return <Editor id={route.id} />

  return (
    <div className="shell">
      <header className="topbar">
        <strong>E-ink Admin</strong>
        <nav>
          <a href="#/creations" className={route.page === 'creations' ? 'active' : ''}>Créations</a>
          <a href="#/devices" className={route.page === 'devices' ? 'active' : ''}>Écrans</a>
          <a href="#/settings" className={route.page === 'settings' ? 'active' : ''}>Options</a>
        </nav>
        {user && <span className="muted">{user.name}</span>}
        <button onClick={logout}>Déconnexion</button>
      </header>
      <main>{route.page === 'devices' ? <Devices /> : route.page === 'settings' ? <Settings /> : <Creations />}</main>
    </div>
  )
}
