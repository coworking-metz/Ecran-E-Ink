// Polices de la charte (fichiers dans admin/public/fonts, déclarées dans styles.css).
export const BRAND_FONTS = [
  { family: 'Eveleth Clean', label: 'Eveleth Clean — titres' },
  { family: 'Eveleth Clean Thin', label: 'Eveleth Clean Thin — texte' },
  { family: 'Andalusia', label: 'Andalusia — script du logo' },
  { family: 'Blida Heavy', label: 'Blida Heavy' },
  { family: 'Blida Medium', label: 'Blida Medium' },
  { family: 'Blida Light', label: 'Blida Light' },
  { family: 'Track', label: 'Track' },
  { family: 'Track Italic', label: 'Track Italic' },
  { family: 'Aldo the Apache', label: 'Aldo the Apache (sans accents)' },
]
export const SYSTEM_FONTS = ['sans-serif', 'serif', 'monospace', 'Arial', 'Georgia', 'Verdana', 'Impact']

export const loadBrandFonts = () =>
  Promise.all(BRAND_FONTS.map((f) => document.fonts.load(`40px "${f.family}"`).catch(() => null)))

// Couleurs de la charte (palette Le Poulailler). Sur l'écran, tout est converti en niveaux de gris.
export const PALETTE = [
  ['Blanc', '#ffffff'],
  ['Crème', '#F7E0AE'],
  ['Jaune', '#EAB234'],
  ['Gris clair', '#BDC3C7'],
  ['Vert-noir', '#374140'],
  ['Noir charte', '#2A2C2B'],
  ['Noir', '#000000'],
  ['Bleu', '#2962FF'],
]
