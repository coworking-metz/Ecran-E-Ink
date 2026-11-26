import { useEffect, useState } from 'react'
import { api } from './api.js'

const SIDES = [['top', 'Haut'], ['right', 'Droite'], ['bottom', 'Bas'], ['left', 'Gauche']]
const clamp = (v) => Math.max(0, Math.min(200, Number.isFinite(v) ? v : 0))

// Réglage du passe-partout : marges noires autour de l'image affichée, valables pour tous les slides.
export default function Calibration() {
  const [settings, setSettings] = useState(null)
  const [margins, setMargins] = useState({ top: 0, right: 0, bottom: 0, left: 0 })
  const [status, setStatus] = useState('')
  const [calUntil, setCalUntil] = useState(0)
  const [now, setNow] = useState(Date.now())

  const apply = (s) => {
    setSettings(s)
    setMargins(s.margins)
    setCalUntil(s.calibration_seconds_left > 0 ? Date.now() + s.calibration_seconds_left * 1000 : 0)
  }
  useEffect(() => { api.settings().then(apply) }, [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  if (!settings) return <p>Chargement…</p>
  const { screen } = settings
  const canvas = { width: screen.width - margins.left - margins.right, height: screen.height - margins.top - margins.bottom }
  const dirty = SIDES.some(([k]) => margins[k] !== settings.margins[k])
  const calLeft = Math.max(0, Math.ceil((calUntil - now) / 1000))
  const set = (k, v) => { setMargins((m) => ({ ...m, [k]: clamp(v) })); setStatus('') }

  const save = async () => {
    try { apply(await api.saveSettings({ margins })); setStatus('Enregistré : appliqué à tous les slides ✓') } catch (e) { setStatus(`Erreur : ${e.message}`) }
  }
  const toggleMire = async () => {
    try { apply(await api.setCalibration(calLeft === 0)) } catch (e) { setStatus(`Erreur : ${e.message}`) }
  }
  const pct = (v, total) => `${(v / total) * 100}%`

  return (
    <>
      <h2>Calibrage de l'écran</h2>
      <p className="muted">
        Le passe-partout recouvre le bord de la dalle. Ajoute une marge noire de chaque côté pour que l'image corresponde à ce qui est
        réellement visible. Ce réglage s'applique à <strong>tous les slides</strong> : leur canvas dans l'éditeur est simplement un peu plus petit.
      </p>

      <div className="calib">
        <div className="card">
          <div className="calib-preview" style={{ aspectRatio: `${screen.width} / ${screen.height}` }}>
            <div className="calib-inner" style={{ left: pct(margins.left, screen.width), right: pct(margins.right, screen.width), top: pct(margins.top, screen.height), bottom: pct(margins.bottom, screen.height) }}>
              <span>{canvas.width} × {canvas.height}</span>
            </div>
          </div>
          <p className="muted dim">Aperçu : noir = marges ajoutées, blanc = zone utile où les slides sont dessinés (écran : {screen.width} × {screen.height}).</p>
        </div>

        <div className="card">
          <div className="calib-fields">
            {SIDES.map(([k, label]) => (
              <label key={k}>{label} (px)
                <span className="stepper">
                  <button onClick={() => set(k, margins[k] - 1)} disabled={margins[k] <= 0}>−</button>
                  <input type="number" min="0" max="200" value={margins[k]} onChange={(e) => set(k, Number(e.target.value))} />
                  <button onClick={() => set(k, margins[k] + 1)} disabled={margins[k] >= 200}>+</button>
                </span>
              </label>
            ))}
          </div>
          <div className="row">
            <button className="primary" onClick={save} disabled={!dirty}>Enregistrer</button>
            <button onClick={() => { setMargins({ top: 0, right: 0, bottom: 0, left: 0 }); setStatus('') }}>Tout remettre à zéro</button>
            {status && <span className={status.startsWith('Erreur') ? 'error' : 'muted'}>{status}</span>}
          </div>

          <h3>Mire sur l'écran réel</h3>
          <p className="muted">
            Affiche sur la dalle un cadre au bord de la zone utile, avec des graduations tous les 10 px. Règle les marges jusqu'à ce que le cadre soit
            entièrement visible sans être masqué par le passe-partout, puis enregistre : l'écran se met à jour tout de suite.
          </p>
          <div className="row">
            <button className={calLeft > 0 ? 'danger' : ''} onClick={toggleMire}>{calLeft > 0 ? 'Arrêter la mire' : 'Afficher la mire sur l’écran'}</button>
            {calLeft > 0 && <span className="muted">mire active, encore {Math.floor(calLeft / 60)} min {String(calLeft % 60).padStart(2, '0')} s (s'éteint toute seule)</span>}
          </div>
        </div>
      </div>
      <p className="muted dim">Les slides existants sont remis à l'échelle à leur prochaine ouverture dans l'éditeur ; en attendant, l'écran les affiche déjà ajustés à la zone utile.</p>
    </>
  )
}
