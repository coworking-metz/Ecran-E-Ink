import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text, Image as KImage, Transformer } from 'react-konva'
import useImage from 'use-image'
import { api } from './api.js'
import { BRAND_FONTS, SYSTEM_FONTS, PALETTE, loadBrandFonts } from './fonts.js'
import { textAttrs, rectAttrs, imageAttrs, assetUrl } from './sceneUtils.js'
import { applyForm } from './form.js'
import { qrDataUrl } from './renderScene.js'

const uid = () => Math.random().toString(36).slice(2, 10)
const gray = (level) => { const v = Math.round((level / 15) * 255).toString(16).padStart(2, '0'); return `#${v}${v}${v}` }
const grayLevel = (hex) => { const m = /^#([0-9a-f]{2})/i.exec(hex || ''); return m ? Math.round((parseInt(m[1], 16) / 255) * 15) : 0 }
const r = Math.round

// Poignées communes : sélection, déplacement.
const common = (onSelect, onChange) => ({
  draggable: true,
  onMouseDown: onSelect,
  onTap: onSelect,
  onDragEnd: (e) => onChange({ x: r(e.target.x()), y: r(e.target.y()) }),
})

function ImageNode({ layer, onSelect, onChange }) {
  const [img] = useImage(assetUrl(layer.assetId), 'anonymous')
  return (
    <KImage
      {...imageAttrs(layer)} image={img} {...common(onSelect, onChange)}
      onTransformEnd={(e) => {
        const n = e.target
        const w = Math.max(10, n.width() * n.scaleX()), h = Math.max(10, n.height() * n.scaleY())
        n.scaleX(1); n.scaleY(1)
        onChange({ x: r(n.x()), y: r(n.y()), width: r(w), height: r(h), rotation: r(n.rotation()) })
      }}
    />
  )
}

// QR code : image générée à partir de `value` à la taille exacte du calque (modules nets, noir sur blanc).
function QrNode({ layer, onSelect, onChange }) {
  const [src, setSrc] = useState('')
  useEffect(() => { qrDataUrl(layer.value, layer.width).then(setSrc) }, [layer.value, layer.width])
  const [img] = useImage(src)
  return (
    <KImage
      {...imageAttrs(layer)} image={img} {...common(onSelect, onChange)}
      onTransformEnd={(e) => {
        const n = e.target
        const w = Math.max(60, Math.max(n.width() * n.scaleX(), n.height() * n.scaleY()))
        n.scaleX(1); n.scaleY(1)
        onChange({ x: r(n.x()), y: r(n.y()), width: r(w), height: r(w), rotation: r(n.rotation()) })
      }}
    />
  )
}

function RectNode({ layer, onSelect, onChange }) {
  return (
    <Rect
      {...rectAttrs(layer)} {...common(onSelect, onChange)}
      onTransformEnd={(e) => {
        const n = e.target
        const w = Math.max(2, n.width() * n.scaleX()), h = Math.max(2, n.height() * n.scaleY())
        n.scaleX(1); n.scaleY(1)
        onChange({ x: r(n.x()), y: r(n.y()), width: r(w), height: r(h), rotation: r(n.rotation()) })
      }}
    />
  )
}

function TextNode({ layer, onSelect, onChange }) {
  return (
    <Text
      {...textAttrs(layer)} {...common(onSelect, onChange)}
      onTransformEnd={(e) => {
        const n = e.target
        const w = Math.max(20, n.width() * n.scaleX())
        n.scaleX(1); n.scaleY(1)
        onChange({ x: r(n.x()), y: r(n.y()), width: r(w), rotation: r(n.rotation()) })
      }}
    />
  )
}

function Swatches({ value, onPick }) {
  return (
    <div className="swatches">
      {PALETTE.map(([name, hex]) => (
        <button key={hex} title={name} className={`swatch ${value?.toLowerCase() === hex.toLowerCase() ? 'on' : ''}`} style={{ background: hex }} onClick={() => onPick(hex)} />
      ))}
    </div>
  )
}

export default function Editor({ id }) {
  const [scene, setScene] = useState(null)
  const [name, setName] = useState('')
  const [isTemplate, setIsTemplate] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [assets, setAssets] = useState([])
  const [devices, setDevices] = useState([])
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState(true) // aperçu niveaux de gris
  const [scale, setScale] = useState(0.5)
  const [fontsReady, setFontsReady] = useState(false)
  const [mode, setMode] = useState('layers') // 'form' (saisie guidée) | 'layers' (édition libre)

  const stageRef = useRef(null)
  const trRef = useRef(null)
  const trLayerRef = useRef(null)
  const areaRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    api.creation(id).then((c) => { setScene(applyForm(c.scene)); setName(c.name); setIsTemplate(!!c.is_template); setMode(c.scene.form?.fields?.length ? 'form' : 'layers') })
    api.assets().then(setAssets)
    api.devices().then(setDevices)
    // Les polices doivent être chargées avant le premier rendu du canvas (sinon mesure du texte erronée).
    loadBrandFonts().then(() => { setScene((sc) => (sc ? applyForm(sc) : sc)); setFontsReady(true) })
  }, [id])

  // Adapte l'échelle d'affichage à la zone disponible (le canvas reste à la taille native de l'écran).
  useEffect(() => {
    if (!scene || !areaRef.current) return
    const el = areaRef.current
    const fit = () => setScale(Math.min((el.clientWidth - 32) / scene.width, (el.clientHeight - 56) / scene.height, 1))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scene?.width, scene?.height, !!scene])

  const selected = useMemo(() => scene?.layers.find((l) => l.id === selectedId) ?? null, [scene, selectedId])
  const assetName = (aid) => { const a = assets.find((x) => x.id === aid); return a ? (a.brand_key ?? a.filename) : `#${aid}` }

  // Attache le Transformer au calque sélectionné.
  useEffect(() => {
    const tr = trRef.current
    if (!tr || !stageRef.current) return
    const node = selectedId ? stageRef.current.findOne('#' + selectedId) : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, scene, fontsReady])

  const update = useCallback((fn) => { setScene((s) => fn(s)); setDirty(true) }, [])
  const patchLayer = useCallback((lid, patch) => update((s) => ({ ...s, layers: s.layers.map((l) => (l.id === lid ? { ...l, ...patch } : l)) })), [update])
  // Saisie d'un champ du formulaire : met à jour la valeur puis recalcule les textes liés.
  const setField = (key, value) => update((s) => applyForm({ ...s, form: { ...s.form, fields: s.form.fields.map((f) => (f.key === key ? { ...f, value } : f)) } }))
  const hasForm = !!scene?.form?.fields?.length
  const formMode = hasForm && mode === 'form'
  const addLayer = (l) => { update((s) => ({ ...s, layers: [...s.layers, l] })); setSelectedId(l.id) }

  const addText = () => addLayer({ id: uid(), type: 'text', text: 'Votre texte', x: 100, y: 100, width: 600, rotation: 0, fontSize: 80, fontFamily: 'Eveleth Clean', fontStyle: 'normal', fill: '#2A2C2B', align: 'left', lineHeight: 1.15 })
  const addQr = () => addLayer({ id: uid(), type: 'qr', x: 100, y: 100, width: 300, height: 300, rotation: 0, value: 'https://' })
  const addRect = () => addLayer({ id: uid(), type: 'rect', x: 100, y: 100, width: 400, height: 200, fill: '#EAB234', rotation: 0, opacity: 1 })
  const addImage = (a) => {
    const ratio = Math.min((scene.width * 0.6) / a.width, (scene.height * 0.6) / a.height, 1)
    const w = r(a.width * ratio), h = r(a.height * ratio)
    addLayer({ id: uid(), type: 'image', assetId: a.id, x: r((scene.width - w) / 2), y: r((scene.height - h) / 2), width: w, height: h, rotation: 0 })
  }
  const upload = async (e) => {
    for (const f of e.target.files) {
      try { const a = await api.uploadAsset(f); setAssets((x) => [a, ...x]) } catch (err) { alert(`Import impossible : ${err.message}`) }
    }
    e.target.value = ''
  }
  const removeLayer = (lid) => { update((s) => ({ ...s, layers: s.layers.filter((l) => l.id !== lid) })); setSelectedId(null) }
  const duplicate = (lid) => {
    const src = scene.layers.find((l) => l.id === lid)
    addLayer({ ...src, id: uid(), x: src.x + 30, y: src.y + 30 })
  }
  const move = (lid, dir) => update((s) => {
    const i = s.layers.findIndex((l) => l.id === lid), j = i + dir
    if (j < 0 || j >= s.layers.length) return s
    const layers = [...s.layers]; [layers[i], layers[j]] = [layers[j], layers[i]]
    return { ...s, layers }
  })

  const exportPng = () => {
    trLayerRef.current.visible(false)
    const data = stageRef.current.toDataURL({ pixelRatio: 1 / scale, mimeType: 'image/png' })
    trLayerRef.current.visible(true)
    return data
  }

  const save = useCallback(async () => {
    setStatus('Enregistrement…')
    try {
      const saved = await api.saveCreation(id, { name, scene, png: exportPng(), is_template: isTemplate })
      setDirty(false); setStatus('Enregistré ✓')
      return saved
    } catch (e) { setStatus(`Erreur : ${e.message}`) }
  }, [id, name, scene, scale, isTemplate])

  // Ajoute la création à la playlist de l'écran (sans doublon). Durée et dates se règlent dans la page Écrans.
  const publish = async (deviceId) => {
    if (!deviceId) return
    const saved = await save()
    if (!saved) return
    const dev = devices.find((d) => d.id === Number(deviceId))
    if (dev?.slides.some((s) => s.creation_id === Number(id))) {
      setStatus('Déjà dans la playlist de cet écran (réglages dans la page Écrans)')
      return
    }
    await api.addSlide(deviceId, { creation_id: Number(id) })
    api.devices().then(setDevices)
    setStatus('Ajouté à la playlist ✓ (l’écran le prendra en compte à son prochain passage)')
  }

  const downloadPng = () => {
    const a = document.createElement('a')
    a.href = exportPng(); a.download = `${name || 'creation'}.png`; a.click()
  }

  // Raccourcis : Ctrl+S, Suppr, flèches.
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return }
      if (typing || !selectedId) return
      const step = e.shiftKey ? 10 : 1
      if (e.key === 'Delete' || e.key === 'Backspace') removeLayer(selectedId)
      else if (e.key === 'ArrowLeft') { e.preventDefault(); patchLayer(selectedId, { x: selected.x - step }) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); patchLayer(selectedId, { x: selected.x + step }) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); patchLayer(selectedId, { y: selected.y - step }) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); patchLayer(selectedId, { y: selected.y + step }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const warn = (e) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!scene) return <p style={{ padding: 24 }}>Chargement…</p>

  const back = () => { if (!dirty || confirm('Modifications non enregistrées. Quitter ?')) location.hash = '#/creations' }
  const brandAssets = assets.filter((a) => a.brand_key)
  const myAssets = assets.filter((a) => !a.brand_key)

  const AssetTile = ({ a }) => (
    <div className="asset" title={a.brand_key ?? a.filename}>
      <img src={assetUrl(a.id)} alt={a.filename} onClick={() => addImage(a)} />
      {a.brand_key
        ? <span className="brand">charte</span>
        : <button className="x" onClick={async () => { if (confirm('Supprimer cette image de la bibliothèque ?')) { await api.deleteAsset(a.id); setAssets((x) => x.filter((i) => i.id !== a.id)) } }}>×</button>}
    </div>
  )

  return (
    <div className="editor">
      <header className="topbar">
        <button onClick={back}>← Créations</button>
        <input className="name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} placeholder="Nom de la création" />
        {isTemplate && <span className="badge">Template</span>}
        <span className="muted status">{dirty ? 'Modifié • ' : ''}{status}</span>
        <span className="spacer" />
        {hasForm && (
          <span className="seg">
            <button className={mode === 'form' ? 'on' : ''} onClick={() => { setMode('form'); setSelectedId(null) }}>Formulaire</button>
            <button className={mode === 'layers' ? 'on' : ''} onClick={() => setMode('layers')}>Calques</button>
          </span>
        )}
        <label className="check" title="Les templates sont proposés dans la liste pour créer de nouvelles créations">
          <input type="checkbox" checked={isTemplate} onChange={(e) => { setIsTemplate(e.target.checked); setDirty(true) }} /> Template
        </label>
        <label className="check"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Aperçu e-ink</label>
        <button onClick={downloadPng}>Exporter PNG</button>
        <select value="" onChange={(e) => publish(e.target.value)}>
          <option value="">Ajouter à la playlist de…</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}{d.slides.some((s) => s.creation_id === Number(id)) ? ' (déjà dedans)' : ''}</option>)}
        </select>
        <button className="primary" onClick={save}>Enregistrer</button>
      </header>

      <div className={`editor-body ${formMode ? 'form-mode' : ''}`}>
        {formMode && (
          <aside className="left formpanel">
            <h3>Informations à afficher</h3>
            {scene.form.fields.map((f) => (
              <label key={f.key}>{f.label}
                {f.type === 'textarea'
                  ? <textarea rows={3} value={f.value} onChange={(e) => setField(f.key, e.target.value)} />
                  : <input type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'} value={f.value} onChange={(e) => setField(f.key, e.target.value)} />}
              </label>
            ))}
            <p className="muted dim">L'aperçu se met à jour en direct. Pour déplacer ou ajouter des éléments, passe en mode « Calques ».</p>
          </aside>
        )}
        {!formMode && <aside className="left">
          <h3>Ajouter</h3>
          <div className="row">
            <button onClick={addText}>+ Texte</button>
            <button onClick={addRect}>+ Forme</button>
            <button onClick={addQr}>+ QR code</button>
            <button onClick={() => fileRef.current.click()}>+ Image</button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={upload} />
          </div>

          <h3>Charte Le Poulailler</h3>
          <div className="assets">{brandAssets.map((a) => <AssetTile key={a.id} a={a} />)}</div>
          <h3>Mes images</h3>
          <div className="assets">
            {myAssets.length === 0 && <p className="muted">Aucune image importée.</p>}
            {myAssets.map((a) => <AssetTile key={a.id} a={a} />)}
          </div>

          <h3>Calques</h3>
          <ul className="layers">
            {[...scene.layers].reverse().map((l) => (
              <li key={l.id} className={l.id === selectedId ? 'sel' : ''} onClick={() => setSelectedId(l.id)}>
                <span>{l.type === 'text' ? `T  ${l.text.replace(/\n/g, ' ').slice(0, 18)}` : l.type === 'rect' ? '▭  Forme' : l.type === 'qr' ? '▦  QR code' : `▣  ${assetName(l.assetId).slice(0, 18)}`}</span>
                <span className="icons">
                  <button title="Monter" onClick={(e) => { e.stopPropagation(); move(l.id, 1) }}>↑</button>
                  <button title="Descendre" onClick={(e) => { e.stopPropagation(); move(l.id, -1) }}>↓</button>
                </span>
              </li>
            ))}
            {scene.layers.length === 0 && <li className="muted">Aucun calque</li>}
          </ul>
        </aside>}

        <section className="canvas-area" ref={areaRef} onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null) }}>
          {fontsReady ? (
            <div className="stage-wrap" style={{ width: scene.width * scale, height: scene.height * scale, filter: preview ? 'grayscale(1)' : 'none' }}>
              <Stage
                ref={stageRef}
                width={scene.width * scale} height={scene.height * scale}
                scaleX={scale} scaleY={scale}
                onMouseDown={(e) => { if (e.target === e.target.getStage() || e.target.attrs.name === 'bg') setSelectedId(null) }}
                onTouchStart={(e) => { if (e.target === e.target.getStage() || e.target.attrs.name === 'bg') setSelectedId(null) }}
              >
                <Layer listening={!formMode}>
                  <Rect name="bg" x={0} y={0} width={scene.width} height={scene.height} fill={scene.background} />
                  {scene.layers.map((l) => {
                    const p = { layer: l, onSelect: () => setSelectedId(l.id), onChange: (patch) => patchLayer(l.id, patch) }
                    return l.type === 'text' ? <TextNode key={l.id} {...p} /> : l.type === 'rect' ? <RectNode key={l.id} {...p} /> : l.type === 'qr' ? <QrNode key={l.id} {...p} /> : <ImageNode key={l.id} {...p} />
                  })}
                </Layer>
                <Layer ref={trLayerRef}>
                  <Transformer
                    ref={trRef}
                    rotateEnabled
                    keepRatio={selected?.type === 'image' || selected?.type === 'qr'}
                    enabledAnchors={selected?.type === 'text' ? ['middle-left', 'middle-right'] : undefined}
                    boundBoxFunc={(o, n) => (n.width < 10 || n.height < 10 ? o : n)}
                  />
                </Layer>
              </Stage>
            </div>
          ) : <p className="muted">Chargement des polices…</p>}
          <p className="muted dim">{scene.width} × {scene.height} px · zoom {r(scale * 100)} %</p>
        </section>

        {!formMode && <aside className="right">
          <h3>Fond</h3>
          <Swatches value={scene.background} onPick={(c) => update((s) => ({ ...s, background: c }))} />

          {selected ? (
            <>
              <h3>{selected.type === 'text' ? 'Texte' : selected.type === 'rect' ? 'Forme' : selected.type === 'qr' ? 'QR code' : 'Image'}</h3>
              {selected.type === 'qr' && (selected.bind
                ? <p className="muted bound">Lien lié au formulaire : <code>{selected.bind.tpl}</code><button onClick={() => patchLayer(selected.id, { bind: undefined })}>Détacher</button></p>
                : <label>Lien ou texte du QR code<input value={selected.value} onChange={(e) => patchLayer(selected.id, { value: e.target.value })} /></label>)}
              {selected.type === 'text' && (
                <>
                  {selected.bind ? (
                    <p className="muted bound">Texte lié au formulaire : <code>{selected.bind.tpl}</code>
                      <button onClick={() => patchLayer(selected.id, { bind: undefined })}>Détacher</button>
                    </p>
                  ) : <label>Contenu<textarea rows={3} value={selected.text} onChange={(e) => patchLayer(selected.id, { text: e.target.value })} /></label>}
                  <label>Police
                    <select value={selected.fontFamily} onChange={(e) => patchLayer(selected.id, { fontFamily: e.target.value })}>
                      <optgroup label="Charte Le Poulailler">
                        {BRAND_FONTS.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
                      </optgroup>
                      <optgroup label="Système">
                        {SYSTEM_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </optgroup>
                    </select>
                  </label>
                  <label>Taille ({selected.fontSize}px)
                    <input type="range" min={10} max={400} value={selected.fontSize} onChange={(e) => patchLayer(selected.id, { fontSize: Number(e.target.value) })} />
                  </label>
                  <label>Alignement
                    <select value={selected.align} onChange={(e) => patchLayer(selected.id, { align: e.target.value })}>
                      <option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option>
                    </select>
                  </label>
                </>
              )}
              {(selected.type === 'text' || selected.type === 'rect') && (
                <>
                  <label>Couleur</label>
                  <Swatches value={selected.fill} onPick={(c) => patchLayer(selected.id, { fill: c })} />
                  <label>Gris pur ({grayLevel(selected.fill)}/15, 0 = noir)
                    <input type="range" min={0} max={15} value={grayLevel(selected.fill)} onChange={(e) => patchLayer(selected.id, { fill: gray(Number(e.target.value)) })} />
                  </label>
                </>
              )}
              <label>Opacité ({r((selected.opacity ?? 1) * 100)} %)
                <input type="range" min={0} max={100} value={r((selected.opacity ?? 1) * 100)} onChange={(e) => patchLayer(selected.id, { opacity: Number(e.target.value) / 100 })} />
              </label>
              <div className="row">
                <label>X<input type="number" value={selected.x} onChange={(e) => patchLayer(selected.id, { x: Number(e.target.value) })} /></label>
                <label>Y<input type="number" value={selected.y} onChange={(e) => patchLayer(selected.id, { y: Number(e.target.value) })} /></label>
              </div>
              <div className="row">
                <label>Largeur<input type="number" value={selected.width} onChange={(e) => patchLayer(selected.id, { width: Number(e.target.value) })} /></label>
                {selected.type !== 'text' && <label>Hauteur<input type="number" value={selected.height} onChange={(e) => patchLayer(selected.id, { height: Number(e.target.value) })} /></label>}
                <label>Rotation<input type="number" value={selected.rotation || 0} onChange={(e) => patchLayer(selected.id, { rotation: Number(e.target.value) })} /></label>
              </div>
              <div className="row">
                <button onClick={() => duplicate(selected.id)}>Dupliquer</button>
                <button className="danger" onClick={() => removeLayer(selected.id)}>Supprimer</button>
              </div>
            </>
          ) : <p className="muted">Sélectionne un calque pour le modifier.</p>}
        </aside>}
      </div>
    </div>
  )
}
