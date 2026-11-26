import { useState } from 'react'
import { api } from './api.js'
import AuthImage from './AuthImage.jsx'
import { toLocalInput, fromLocalInput, slideStatus, humanDuration } from './dates.js'

// Playlist d'un écran : les slides actifs défilent dans l'ordre, chacun pendant sa durée.
export default function Playlist({ device, creations, defaultSeconds, onChange }) {
  const [error, setError] = useState('')
  const slides = device.slides
  const usable = creations.filter((c) => !c.is_template)
  const active = slides.filter((s) => slideStatus(s).key === 'on')
  const cycle = active.length > 1 ? active.reduce((sum, s) => sum + (s.duration_seconds ?? defaultSeconds), 0) : 0

  const run = async (fn) => {
    setError('')
    try { await fn() } catch (e) { setError(e.message) }
    onChange()
  }
  const patch = (s, data) => run(() => api.patchSlide(s.id, data))
  const move = (i, dir) => {
    const ids = slides.map((s) => s.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    run(() => api.reorderSlides(device.id, ids))
  }

  return (
    <div className="playlist">
      <div className="row between">
        <h3>Playlist</h3>
        <span className="muted">
          {active.length === 0 ? 'aucun slide actif' : active.length === 1 ? '1 slide actif : affiché en continu' : `${active.length} slides actifs · cycle de ${humanDuration(cycle)}`}
        </span>
      </div>
      {error && <p className="error">{error}</p>}

      {slides.length === 0 && <p className="muted">Aucun slide. Ajoute une création ci-dessous, ou depuis l'éditeur (« Ajouter à la playlist de… »).</p>}
      {slides.map((s, i) => {
        const st = slideStatus(s)
        return (
          <div className={`slide ${st.key}`} key={s.id}>
            <a className="slide-thumb" href={`#/editor/${s.creation_id}`}>
              {s.png_hash ? <AuthImage src={`/api/creations/${s.creation_id}/image?v=${s.png_hash}`} /> : <span className="muted">—</span>}
            </a>
            <div className="slide-body">
              <div className="row between">
                <a href={`#/editor/${s.creation_id}`}><strong>{s.creation_name}</strong></a>
                <span className={`status ${st.key}`}>
                  {device.current_slide_id === s.id && <b>● affiché maintenant · </b>}{st.label}
                </span>
              </div>
              <div className="slide-fields">
                <label>Durée (s)
                  <input type="number" min="30" step="10" placeholder={`défaut : ${defaultSeconds}`} defaultValue={s.duration_seconds ?? ''} key={`d${s.duration_seconds}`}
                    onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== s.duration_seconds) patch(s, { duration_seconds: v }) }} />
                </label>
                <label>Début
                  <input type="datetime-local" defaultValue={toLocalInput(s.starts_at)} key={`s${s.starts_at}`}
                    onBlur={(e) => { const v = fromLocalInput(e.target.value); if (v !== s.starts_at) patch(s, { starts_at: v }) }} />
                </label>
                <label>Fin
                  <input type="datetime-local" defaultValue={toLocalInput(s.ends_at)} key={`e${s.ends_at}`}
                    onBlur={(e) => { const v = fromLocalInput(e.target.value); if (v !== s.ends_at) patch(s, { ends_at: v }) }} />
                </label>
                <label className="check inline"><input type="checkbox" checked={!!s.enabled} onChange={(e) => patch(s, { enabled: e.target.checked })} /> Actif</label>
                <button className="show-now" disabled={st.key !== 'on'} onClick={() => run(() => api.showSlide(s.id))}
                  title={st.key === 'on' ? "Affiche ce slide tout de suite ; la rotation reprend ensuite avec les suivants" : "Ce slide n'est pas actif en ce moment (désactivé, hors de sa période ou sans image)"}>
                  {device.current_slide_id === s.id ? '↻ Relancer' : '▶ Afficher maintenant'}
                </button>
                <span className="slide-actions">
                  <button title="Monter" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button title="Descendre" disabled={i === slides.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="danger" title="Retirer de la playlist" onClick={() => run(() => api.deleteSlide(s.id))}>Retirer</button>
                </span>
              </div>
            </div>
          </div>
        )
      })}

      <select value="" onChange={(e) => e.target.value && run(() => api.addSlide(device.id, { creation_id: Number(e.target.value) }))}>
        <option value="">+ Ajouter un slide…</option>
        {usable.map((c) => <option key={c.id} value={c.id}>{c.name}{c.png_hash ? '' : ' (pas encore enregistrée)'}</option>)}
      </select>
    </div>
  )
}
