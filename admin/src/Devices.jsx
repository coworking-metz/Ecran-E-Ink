import { useEffect, useState } from 'react'
import { api } from './api.js'
import Playlist from './Playlist.jsx'

export default function Devices() {
  const [devices, setDevices] = useState(null)
  const [creations, setCreations] = useState([])
  const [settings, setSettings] = useState({ default_slide_seconds: 120 })
  const load = () => Promise.all([api.devices(), api.creations(), api.settings()]).then(([d, c, s]) => { setDevices(d); setCreations(c); setSettings(s) })
  useEffect(() => { load() }, [])
  // Rafraîchit l'état des écrans (en ligne, ce qu'ils affichent, accusés de réception) sans recharger la page.
  useEffect(() => { const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  const [notice, setNotice] = useState({})

  // Création immédiate : le nom se modifie ensuite directement dans la carte.
  const add = async () => {
    await api.createDevice({ name: `Écran ${(devices?.length ?? 0) + 1}` })
    load()
  }
  const rename = async (d, name) => { if (name.trim() && name !== d.name) { await api.patchDevice(d.id, { name: name.trim() }); load() } }
  const setRefresh = async (d, v) => { await api.patchDevice(d.id, { refresh_seconds: Number(v) }); load() }
  const forceRefresh = async (d) => {
    try { await api.refreshDevice(d.id); setNotice((n) => ({ ...n, [d.id]: '' })) } catch (e) { setNotice((n) => ({ ...n, [d.id]: e.message })) }
    load()
  }
  const remove = async (d) => { if (confirm(`Supprimer « ${d.name} » ?`)) { await api.deleteDevice(d.id); load() } }

  const seen = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString() : 'jamais')

  return (
    <>
      <div className="row between">
        <h2>Écrans</h2>
        <button className="primary" onClick={add}>+ Ajouter un écran</button>
      </div>
      {!devices ? <p>Chargement…</p> : devices.length === 0 ? <p className="muted">Aucun écran. Ajoute-en un pour obtenir son token à mettre dans la config du Pi.</p> : (
        <div className="list">
          {devices.map((d) => (
            <div className="card" key={d.id}>
              <div className="row between">
                <input className="title" defaultValue={d.name} key={d.name} onBlur={(e) => rename(d, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                <button className="danger" onClick={() => remove(d)}>Supprimer</button>
              </div>
              <div className="row between device-status">
                <span className={`status ${d.online ? 'on' : ''}`}>
                  {d.online ? '● en ligne' : '○ hors ligne'}
                  {d.shown_name ? ` · affiche : ${d.shown_name}` : d.shown_hash ? ' · affiche une image inconnue' : ''}
                </span>
                <span className="row" style={{ gap: 8 }}>
                  {notice[d.id] && <span className="error">{notice[d.id]}</span>}
                  {d.refresh_pending && <span className="muted">rafraîchissement en attente…</span>}
                  <button onClick={() => forceRefresh(d)} disabled={d.refresh_pending}
                    title="Efface puis redessine l'écran en entier (élimine les rémanences), même si l'image n'a pas changé">
                    ↻ Forcer le rafraîchissement
                  </button>
                </span>
              </div>
              <div className="form">
                <label>Vérifie les modifications toutes les
                  <select value={d.refresh_seconds} onChange={(e) => setRefresh(d, e.target.value)}>
                    {[[60, '1 min'], [300, '5 min'], [900, '15 min'], [1800, '30 min'], [3600, '1 h']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label>Résolution<input value={`${d.width} × ${d.height}`} readOnly /></label>
                <label>Dernier passage<input value={seen(d.last_seen)} readOnly /></label>
                <label className="wide">Token (à mettre dans la config du Pi)
                  <input value={d.token} readOnly onFocus={(e) => e.target.select()} />
                </label>
              </div>
              <Playlist device={d} creations={creations} defaultSeconds={settings.default_slide_seconds} onChange={load} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
