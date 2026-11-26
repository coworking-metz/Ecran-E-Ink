// Importe les visuels et polices de la charte depuis le dossier Communication (Nextcloud).
// Usage : node scripts/import-brand.mjs <dossier-source>   (ou variable BRAND_SOURCE)
// Sortie : brand/images/*.png (visuels rognés) et admin/public/fonts/* (polices servies par l'éditeur).
import sharp from 'sharp'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2] || process.env.BRAND_SOURCE
if (!SRC) {
  console.error('Usage : node scripts/import-brand.mjs <dossier Communication du coworking>   (ou BRAND_SOURCE=<dossier>)')
  process.exit(1)
}
const L = join(SRC, 'Logo Le Poulailler')

// key -> { file, trim, cover:[w,h], max }
const IMAGES = {
  'logo-vertical':        { file: join(L, 'logo-lepoulailler.png'), trim: true, max: 1400 },
  'logo-vertical-blanc':  { file: join(L, 'logo-lepoulailler-blanc.png'), trim: true, max: 1400 }, // texte blanc, pour fonds sombres
  'logo-horizontal':      { file: join(L, 'Logo Le Poulailler horizontal.png'), trim: true, max: 1600 },
  'typo':                 { file: join(L, 'Elements/typo-lepoulailler.png'), trim: true, max: 1600 },
  'typo-blanc':           { file: join(L, 'Elements/typo-lepoulailler-blanc.png'), trim: true, max: 1600 },
  'icone':                { file: join(L, 'Elements/icone-lepoulailler.png'), trim: true, max: 800 },
  'ninja':                { file: join(L, 'Logo-ninja/ninja-full.png'), trim: true, max: 800 },
  'fond-fresque':         { file: join(L, 'fond-pti-poul.jpg'), cover: [1200, 825] },
}

// Polices : nom de fichier propre -> source. Le doublon « EvelethCleanThin - Copy.otf » est ignoré.
const FONTS = {
  'Blida-Light.ttf': 'Blida_light.ttf',
  'Blida-Medium.ttf': 'Blida_medium.ttf',
  'Blida-Heavy.ttf': 'Blida_heavy.ttf',
  'EvelethClean-Regular.otf': 'EvelethClean.otf',
  'EvelethClean-Thin.otf': 'EvelethCleanThin.otf',
  'Track.ttf': 'Track.ttf',
  'Track-Italic.ttf': 'Track Italic.ttf',
  'Andalusia.ttf': 'Andalusia.ttf',
  'AldoTheApache.ttf': 'AldotheApache.ttf',
}

for (const [key, o] of Object.entries(IMAGES)) {
  let img = sharp(o.file)
  if (o.trim) img = img.trim()
  if (o.cover) img = img.resize(o.cover[0], o.cover[1], { fit: 'cover' })
  else img = img.resize({ width: o.max, height: o.max, fit: 'inside', withoutEnlargement: true })
  const out = join(root, 'brand/images', `${key}.png`)
  await img.png({ compressionLevel: 9 }).toFile(out)
  const m = await sharp(out).metadata()
  console.log(`image  ${key}.png  ${m.width}x${m.height}`)
}

mkdirSync(join(root, 'admin/public/fonts'), { recursive: true })
for (const [name, src] of Object.entries(FONTS)) {
  copyFileSync(join(SRC, 'Fonts', src), join(root, 'admin/public/fonts', name))
  console.log(`police ${name}`)
}
