import { useEffect, useState } from 'react'
import { api } from './api.js'
import { humanDuration } from './dates.js'

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [creations, setCreations] = useState([])
  const [status, setStatus] = useState('')
  useEffect(() => { Promise.all([api.settings(), api.creations()]).then(([s, c]) => { setSettings(s); setCreations(c) }) }, [])

  const save = async (patch) => {
    setStatus('')
    try { setSettings(await api.saveSettings(patch)); setStatus('Enregistré ✓') } catch (e) { setStatus(`Erreur : ${e.message}`) }
  }
  if (!settings) return <p>Chargement…</p>

  return (
    <>
      <h2>Options</h2>
      <div className="card settings">
        <label>Durée d'affichage par défaut d'un slide (secondes)
          <input type="number" min="30" step="10" defaultValue={settings.default_slide_seconds} key={settings.default_slide_seconds}
            onBlur={(e) => Number(e.target.value) !== settings.default_slide_seconds && save({ default_slide_seconds: Number(e.target.value) })} />
          <span className="muted">= {humanDuration(settings.default_slide_seconds)} par slide. Modifiable slide par slide dans la playlist de chaque écran. Minimum 30 s.</span>
        </label>
        <label>Slide de repli
          <select value={settings.fallback_creation_id ?? ''} onChange={(e) => save({ fallback_creation_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— aucun : l'écran garde sa dernière image —</option>
            {creations.filter((c) => c.png_hash).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_template ? ' (template)' : ''}</option>)}
          </select>
          <span className="muted">Affiché quand aucun slide n'est actif (périodes terminées, playlist vide). Conseillé : le logo plein écran.</span>
        </label>
        <p className="muted">Chaque changement de slide rafraîchit l'écran e-ink (≈ 2 s avec un flash). Des durées longues (≥ 1 min) ménagent la dalle.</p>
        {status && <p className={status.startsWith('Erreur') ? 'error' : 'muted'}>{status}</p>}
      </div>
    </>
  )
}
