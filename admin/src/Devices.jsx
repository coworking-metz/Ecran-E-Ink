import { useEffect, useState } from 'react'
import { api } from './api.js'

export default function Devices() {
  const [devices, setDevices] = useState(null)
  const [creations, setCreations] = useState([])
  const load = () => Promise.all([api.devices(), api.creations()]).then(([d, c]) => { setDevices(d); setCreations(c) })
  useEffect(() => { load() }, [])

  // Création immédiate : le nom se modifie ensuite directement dans la carte.
  const add = async () => {
    await api.createDevice({ name: `Écran ${(devices?.length ?? 0) + 1}` })
    load()
  }
  const rename = async (d, name) => { if (name.trim() && name !== d.name) { await api.patchDevice(d.id, { name: name.trim() }); load() } }
  const assign = async (d, creation_id) => { await api.patchDevice(d.id, { creation_id: creation_id ? Number(creation_id) : null }); load() }
  const setRefresh = async (d, v) => { await api.patchDevice(d.id, { refresh_seconds: Number(v) }); load() }
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
              <div className="form">
                <label>Création affichée
                  <select value={d.creation_id ?? ''} onChange={(e) => assign(d, e.target.value)}>
                    <option value="">— aucune —</option>
                    {creations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label>Rafraîchissement
                  <select value={d.refresh_seconds} onChange={(e) => setRefresh(d, e.target.value)}>
                    {[[60, '1 min'], [300, '5 min'], [900, '15 min'], [1800, '30 min'], [3600, '1 h'], [21600, '6 h']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label>Résolution<input value={`${d.width} × ${d.height}`} readOnly /></label>
                <label>Dernier passage<input value={seen(d.last_seen)} readOnly /></label>
                <label className="wide">Token (à mettre dans la config du Pi)
                  <input value={d.token} readOnly onFocus={(e) => e.target.select()} />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
