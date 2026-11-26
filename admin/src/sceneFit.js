// Remet une scène à l'échelle d'un nouveau canvas (zone utile de l'écran = écran moins les marges du passe-partout).
// Les slides existants et les templates sont conçus en 1200 × 825 : quand les marges changent, leur composition
// est conservée (positions et tailles proportionnelles) au lieu d'être rognée.
//   positions et largeurs : proportionnelles à chaque axe ; textes et QR : échelle uniforme (pas de déformation).
// Fonction pure ; renvoie la même scène (même objet) si le canvas n'a pas changé.
const R = Math.round

export function fitScene(scene, width, height) {
  if (!scene || (scene.width === width && scene.height === height)) return scene
  const sx = width / scene.width
  const sy = height / scene.height
  const s = Math.min(sx, sy)
  const fullBleed = (l) => l.x <= 0 && l.y <= 0 && l.x + l.width >= scene.width - 1 && l.y + (l.height ?? 0) >= scene.height - 1

  const layers = scene.layers.map((l) => {
    const moved = { ...l, x: R(l.x * sx), y: R(l.y * sy) }
    if (l.type === 'text') {
      return {
        ...moved,
        width: R(l.width * sx),
        fontSize: Math.max(1, R(l.fontSize * s)),
        ...(l.baseSize ? { baseSize: Math.max(1, R(l.baseSize * s)) } : {}),
        ...(l.fit ? { fit: { ...l.fit, min: Math.max(1, R(l.fit.min * s)) } } : {}),
      }
    }
    if (l.type === 'qr') return { ...moved, width: R(l.width * s), height: R(l.width * s) }
    if (fullBleed(l)) return { ...l, x: 0, y: 0, width, height } // fond ou image plein cadre : couvre exactement le canvas
    return { ...moved, width: R(l.width * sx), height: R(l.height * sy) }
  })
  return { ...scene, width, height, layers }
}
