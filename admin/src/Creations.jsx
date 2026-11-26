import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import AuthImage from './AuthImage.jsx'
import { renderScenePng } from './renderScene.js'

function Card({ c, children }) {
  return (
    <div className="card">
      <a href={`#/editor/${c.id}`} className="thumb">
        {c.png_hash ? <AuthImage src={`/api/creations/${c.id}/image?v=${c.png_hash}`} /> : <span className="muted">aperçu…</span>}
      </a>
      <div className="row between">
        <a href={`#/editor/${c.id}`}>{c.name}</a>
        <span className="row" style={{ gap: 6 }}>{children}</span>
      </div>
    </div>
  )
}

export default function Creations() {
  const [items, setItems] = useState(null)
  const [rendering, setRendering] = useState(false)
  const busy = useRef(false)
  const load = () => api.creations().then(setItems)
  useEffect(() => { load() }, [])

  // Les templates livrés n'ont pas encore d'aperçu : on les rend ici, une seule fois, avec le même moteur que l'éditeur.
  useEffect(() => {
    if (!items || busy.current) return
    const todo = items.filter((c) => c.is_template && !c.png_hash)
    if (!todo.length) return
    busy.current = true
    setRendering(true)
    ;(async () => {
      for (const t of todo) {
        try {
          const full = await api.creation(t.id)
          const saved = await api.saveCreation(t.id, { png: await renderScenePng(full.scene) })
          setItems((cur) => cur.map((c) => (c.id === t.id ? { ...c, png_hash: saved.png_hash } : c)))
        } catch (e) { console.error('aperçu template', t.id, e) }
      }
      busy.current = false
      setRendering(false)
    })()
  }, [items])

  // Création immédiate : le nom se saisit ensuite dans l'éditeur.
  const create = async () => {
    const c = await api.createCreation({ name: 'Nouvelle création' })
    location.hash = `#/editor/${c.id}`
  }
  const useTemplate = async (t) => {
    const c = await api.duplicateCreation(t.id)
    location.hash = `#/editor/${c.id}`
  }
  const duplicate = async (c) => { await api.duplicateCreation(c.id); load() }
  const remove = async (c) => {
    if (!confirm(`Supprimer « ${c.name} » ?`)) return
    await api.deleteCreation(c.id)
    load()
  }

  const mine = items?.filter((c) => !c.is_template) ?? []
  const templates = items?.filter((c) => c.is_template) ?? []

  return (
    <>
      <div className="row between">
        <h2>Créations</h2>
        <button className="primary" onClick={create}>+ Nouvelle création</button>
      </div>
      {!items ? <p>Chargement…</p> : mine.length === 0 ? <p className="muted">Aucune création pour l'instant. Pars d'un template ci-dessous ou d'une page vierge.</p> : (
        <div className="grid">
          {mine.map((c) => (
            <Card key={c.id} c={c}>
              <button onClick={() => duplicate(c)}>Dupliquer</button>
              <button className="danger" onClick={() => remove(c)}>Supprimer</button>
            </Card>
          ))}
        </div>
      )}

      {templates.length > 0 && (
        <>
          <div className="row between section-title">
            <h2>Templates {rendering && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>— génération des aperçus…</span>}</h2>
          </div>
          <div className="grid">
            {templates.map((t) => (
              <Card key={t.id} c={t}>
                <button className="primary" onClick={() => useTemplate(t)}>Utiliser</button>
                <button onClick={() => (location.hash = `#/editor/${t.id}`)}>Modifier</button>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}
