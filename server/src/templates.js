// Templates du Poulailler (coworking Metz), pensés pour la dalle e-ink 1200×825 en 16 niveaux de gris.
// Règles : texte sombre sur fond clair (ou blanc sur fond sombre), le jaune de la charte ne sert qu'à des aplats
// (il devient un gris moyen-clair sur l'écran), jamais à du texte fin.
//
// Mode formulaire : un template déclare des champs (`b.form([...])`) et lie ses calques texte via `bind`
// (`{ tpl: '{date|long} {time|des}', upper: true }`). L'éditeur recalcule le texte à chaque saisie (admin/src/form.js).
// Formats : long (jeudi 3 décembre) · weekdayShort (jeu.) · day (03) · time (9h30) · des (dès 9h30).
export const W = 1200
export const H = 825

export const C = { ink: '#2A2C2B', teal: '#374140', gold: '#EAB234', cream: '#F7E0AE', blue: '#2962FF', white: '#ffffff', black: '#000000' }
export const F = {
  title: 'Eveleth Clean', // Regular : titres (charte du gabarit)
  body: 'Eveleth Clean Thin', // corps de texte
  script: 'Andalusia', // script du logo
  display: 'Track',
}

const text = (name, label, value, type = 'text') => ({ key: name, label, type, value })

// Fabrique de calques. `assets` = { clé: {id, width, height} }.
export const makeBuilder = (assets) => {
  let n = 0
  const id = () => `l${++n}`
  const layers = []
  let fields = []
  const b = {
    layers,
    get fields() { return fields },
    form: (f) => { fields = f },
    rect: (x, y, width, height, fill, extra = {}) => layers.push({ id: id(), type: 'rect', x, y, width, height, fill, rotation: 0, ...extra }),
    // `o.bind` : texte généré depuis les champs du formulaire ; `text` sert alors de valeur initiale.
    text: (txt, x, y, width, o = {}) =>
      layers.push({
        id: id(), type: 'text', text: txt, x, y, width, rotation: 0,
        fontSize: o.size ?? 36, fontFamily: o.font ?? F.body, fontStyle: 'normal',
        fill: o.fill ?? C.ink, align: o.align ?? 'left', lineHeight: o.lineHeight ?? 1.15,
        // Texte lié : la taille se réduit (jusqu'à `min`) pour tenir en `lines` lignes ; 1 ligne par défaut.
        ...(o.bind ? { bind: o.bind, fit: o.fit ?? { lines: 1, min: Math.round((o.size ?? 36) * 0.5) } } : {}),
      }),
    // QR code (noir sur blanc), généré dans l'éditeur à partir de `value` (ou du champ lié).
    qr: (x, y, size, value, tpl) =>
      layers.push({ id: id(), type: 'qr', x, y, width: size, height: size, rotation: 0, value, ...(tpl ? { bind: { tpl } } : {}) }),
    // Donner `w` OU `h` : l'autre dimension est déduite du ratio de l'image.
    image: (key, x, y, { w, h, ...extra }) => {
      const a = assets[key]
      if (!a) throw new Error(`asset de marque manquant : ${key}`)
      const width = w ?? Math.round((h * a.width) / a.height)
      const height = h ?? Math.round((w * a.height) / a.width)
      layers.push({ id: id(), type: 'image', assetId: a.id, x: x === 'center' ? Math.round((W - width) / 2) : x, y, width, height, rotation: 0, ...extra })
    },
  }
  return b
}

const bind = (tpl, upper = false) => ({ tpl, upper })

// Mise en page « événement » (logo, titre, description, QUAND / OÙ / QUOI) partagée par deux templates.
const eventLayout = (b, d) => {
  b.form([
    text('title', 'Titre', d.title),
    text('desc', 'Description', d.desc, 'textarea'),
    text('date', 'Date', d.date, 'date'),
    text('time', 'Heure de début', d.time, 'time'),
    text('place', 'Lieu', d.place),
    text('extra_label', 'Libellé de la 3e ligne', d.extra_label),
    text('extra', 'Contenu de la 3e ligne', d.extra),
  ])
  b.rect(0, 0, W, H, C.white)
  b.image('logo-horizontal', 'center', 36, { w: 400 })
  b.text(d.title, 30, 190, 1140, { size: 56, font: F.title, align: 'center', bind: bind('{title}', true) })
  b.text(d.desc, 150, 290, 900, { size: 26, align: 'center', bind: bind('{desc}', true), fit: { lines: 3, min: 18 } })
  b.rect(520, 410, 160, 6, C.gold)
  const rows = [
    [bind('QUAND ?'), bind('{date|long} {time|des}', true)],
    [bind('OÙ ?'), bind('{place}', true)],
    [bind('{extra_label}', true), bind('{extra}', true)],
  ]
  rows.forEach(([l, v], i) => {
    const y = 470 + i * 95
    b.text('', 100, y, 360, { size: 40, bind: l })
    b.text('', 470, y, 680, { size: 40, font: F.title, bind: v })
  })
}

export const TEMPLATES = [
  {
    key: 'accueil',
    name: 'Accueil — Bienvenue',
    build(b) {
      b.form([text('headline', 'Titre', 'Lorem ipsum !'), text('tagline', 'Phrase d’accueil', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do')])
      b.rect(0, 0, W, H, C.white)
      b.image('logo-vertical', 'center', 40, { h: 460 })
      b.rect(450, 545, 300, 6, C.gold)
      b.text('', 0, 575, W, { size: 76, font: F.title, align: 'center', bind: bind('{headline}', true) })
      b.text('', 60, 695, 1080, { size: 30, align: 'center', bind: bind('{tagline}', true), fit: { lines: 2, min: 20 } })
    },
  },
  {
    key: 'evenement',
    name: 'Événement',
    build: (b) =>
      eventLayout(b, {
        title: 'Lorem ipsum dolor sit amet',
        desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor',
        date: '2026-12-03', time: '18:00', place: 'Lorem ipsum dolor',
        extra_label: 'Quoi ?', extra: 'Sit amet consectetur',
      }),
  },
  {
    key: 'petit-dej',
    name: 'Petit déjeuner du coworking',
    build: (b) =>
      eventLayout(b, {
        title: 'Petit déjeuner du coworking !',
        desc: 'Chaque premier jeudi du mois, le coworking invite ses adhérents à un petit déjeuner pour commencer la journée en douceur',
        date: '2026-12-03', time: '09:00', place: 'Lorem ipsum (dolor sit amet)',
        extra_label: 'Je ramène quoi ?', extra: 'Lorem ipsum dolor',
      }),
  },
  {
    key: 'annonce-sombre',
    name: 'Annonce (fond sombre)',
    build(b) {
      b.form([text('title', 'Titre', 'Lorem ipsum dolor'), text('message', 'Message', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.', 'textarea')])
      b.rect(0, 0, W, H, C.ink)
      b.image('logo-vertical-blanc', 70, 60, { h: 190 })
      b.rect(70, 330, 120, 8, C.gold)
      b.text('', 70, 365, 1060, { size: 84, font: F.title, fill: C.white, bind: bind('{title}', true) })
      b.text('', 70, 500, 1000, { size: 44, fill: C.white, bind: bind('{message}'), fit: { lines: 5, min: 24 } })
      b.text('LE POULAILLER · COWORKING METZ', 70, 760, 1060, { size: 24, fill: '#bdc3c7' })
    },
  },
  {
    key: 'infos-pratiques',
    name: 'Infos pratiques (Wi-Fi, horaires)',
    build(b) {
      b.form([
        text('ssid', 'Wi-Fi : nom du réseau', 'Lorem-ipsum'),
        text('pwd', 'Wi-Fi : mot de passe', '…'),
        text('hours', 'Horaires', 'Lorem ipsum, dolor sit amet'),
        text('help', 'Besoin d’aide ?', 'Consectetur adipiscing elit sed'),
      ])
      b.rect(0, 0, W, H, C.white)
      b.text('INFOS PRATIQUES', 70, 70, 800, { size: 64, font: F.title })
      b.rect(70, 160, 120, 8, C.gold)
      b.image('icone', 1010, 40, { h: 150 })
      ;[
        ['WI-FI', bind('Réseau : {ssid}      Mot de passe : {pwd}', true)],
        ['HORAIRES', bind('{hours}', true)],
        ["BESOIN D'AIDE ?", bind('{help}', true)],
      ].forEach(([label, v], i) => {
        const y = 230 + i * 180
        b.rect(70, y, 1060, 150, C.cream)
        b.rect(70, y, 14, 150, C.gold)
        b.text(label, 110, y + 22, 960, { size: 36, font: F.title })
        b.text('', 110, y + 80, 960, { size: 38, bind: v })
      })
    },
  },
  {
    key: 'agenda',
    name: 'Agenda de la semaine',
    build(b) {
      const sample = [['2026-11-30', 'Lorem ipsum dolor sit amet', 'Consectetur adipiscing elit sed'], ['2026-12-02', 'Sed do eiusmod tempor', 'Incididunt ut labore et dolore'], ['2026-12-03', 'Ut enim ad minim veniam', 'Quis nostrud exercitation'], ['2026-12-04', 'Duis aute irure dolor', 'In reprehenderit in voluptate']]
      b.form([
        text('heading', 'Titre de l’écran', 'Lorem ipsum dolor sit amet'),
        ...sample.flatMap(([d, t, s], i) => [
          text(`d${i + 1}`, `Ligne ${i + 1} — date`, d, 'date'),
          text(`t${i + 1}`, `Ligne ${i + 1} — titre`, t),
          text(`s${i + 1}`, `Ligne ${i + 1} — détail`, s),
        ]),
      ])
      b.rect(0, 0, W, H, C.white)
      b.text('', 70, 50, 1060, { size: 52, font: F.title, bind: bind('{heading}', true) })
      b.rect(70, 130, 120, 8, C.gold)
      sample.forEach((_, i) => {
        const y = 175 + i * 150, k = i + 1
        b.rect(70, y, 170, 120, C.ink)
        b.text('', 70, y + 14, 170, { size: 30, fill: C.white, align: 'center', bind: bind(`{d${k}|weekdayShort}`, true) })
        b.text('', 70, y + 48, 170, { size: 60, font: F.title, fill: C.white, align: 'center', bind: bind(`{d${k}|day}`) })
        b.text('', 280, y + 14, 850, { size: 42, font: F.title, bind: bind(`{t${k}}`, true) })
        b.text('', 280, y + 70, 850, { size: 32, bind: bind(`{s${k}}`) })
      })
    },
  },
  {
    key: 'citation-fresque',
    name: 'Message sur fresque',
    build(b) {
      b.form([text('message', 'Message', 'Lorem ipsum dolor sit amet', 'textarea')])
      b.image('fond-fresque', 0, 0, { w: W })
      b.rect(100, 180, 1000, 400, C.ink, { opacity: 0.62 })
      b.text('', 140, 270, 920, { size: 96, font: F.script, fill: C.white, align: 'center', lineHeight: 1.1, bind: bind('{message}'), fit: { lines: 4, min: 40 } })
      b.image('typo-blanc', 'center', 650, { w: 300 })
    },
  },
  {
    key: 'avis-de-recherche',
    name: 'Avis de recherche (objet perdu)',
    build(b) {
      b.form([
        text('what', 'Objet', 'Lorem ipsum dolor sit amet'),
        text('when', 'Perdu / trouvé le', 'Lorem ipsum, dolor'),
        text('contact', 'Si tu l’as vu', 'Lorem ipsum'),
      ])
      b.rect(0, 0, W, H, C.ink)
      b.rect(22, 22, W - 44, H - 44, C.white)
      b.text('AVIS DE RECHERCHE', 50, 60, 1100, { size: 84, font: F.display, align: 'center' })
      b.image('ninja', 90, 190, { h: 560 })
      ;[['OBJET', '{what}'], ['PERDU / TROUVÉ LE', '{when}'], ["SI TU L'AS VU", '{contact}']].forEach(([label, tpl], i) => {
        const y = 215 + i * 180
        b.text(label, 650, y, 470, { size: 30, font: F.title })
        b.text('', 650, y + 42, 470, { size: 38, bind: bind(tpl, true), fit: { lines: 3, min: 22 } })
      })
    },
  },
  {
    key: 'logo-veille',
    name: 'Logo plein écran (veille)',
    build(b) {
      b.rect(0, 0, W, H, C.ink)
      b.image('logo-vertical-blanc', 'center', 100, { h: 620 })
    },
  },
]

// Puces : petit carré d'accent + texte lié (une ligne par puce).
const bullet = (b, x, y, w, size, tpl) => {
  b.rect(x, y + Math.round(size * 0.3), Math.round(size * 0.5), Math.round(size * 0.5), C.ink)
  b.text('', x + Math.round(size * 0.9), y, w, { size, bind: bind(tpl), fit: { lines: 1, min: 22 } })
}
const footer = (b) => b.text('LE POULAILLER · COWORKING METZ', 70, 772, 1060, { size: 22, fill: '#8a8f8d' })

export const MORE_TEMPLATES = [
  {
    key: 'consigne',
    name: 'Consigne du lieu (3 règles)',
    build(b) {
      b.form([
        text('title', 'Titre', 'Lorem ipsum dolor sit amet'),
        text('b1', 'Règle 1', 'Lorem ipsum dolor sit amet'),
        text('b2', 'Règle 2', 'Consectetur adipiscing elit'),
        text('b3', 'Règle 3', 'Sed do eiusmod tempor ut'),
      ])
      b.rect(0, 0, W, H, C.white)
      b.image('icone', 70, 50, { h: 130 })
      b.text('', 70, 215, 1060, { size: 80, font: F.title, bind: bind('{title}', true), fit: { lines: 2, min: 48 } })
      b.rect(70, 420, 120, 8, C.gold)
      ;['b1', 'b2', 'b3'].forEach((k, i) => bullet(b, 80, 480 + i * 90, 1000, 42, `{${k}}`))
      footer(b)
    },
  },
  {
    key: 'qr-action',
    name: 'QR code d’action (app, Signal, inscription…)',
    build(b) {
      b.form([
        text('title', 'Titre', 'Lorem ipsum dolor'),
        text('b1', 'Puce 1', 'Lorem ipsum dolor sit amet'),
        text('b2', 'Puce 2', 'Consectetur adipiscing elit'),
        text('b3', 'Puce 3', 'Sed do eiusmod tempor'),
        text('url', 'Lien du QR code', 'https://example.com'),
      ])
      b.rect(0, 0, W, H, C.white)
      b.qr(80, 150, 440, 'https://example.com', '{url}')
      b.text('', 80, 610, 440, { size: 26, align: 'center', bind: bind('{url}'), fit: { lines: 1, min: 14 } })
      b.text('', 590, 150, 540, { size: 64, font: F.title, bind: bind('{title}', true), fit: { lines: 2, min: 40 } })
      b.rect(590, 330, 120, 8, C.gold)
      ;['b1', 'b2', 'b3'].forEach((k, i) => {
        const y = 380 + i * 105
        b.rect(590, y + 10, 20, 20, C.ink)
        b.text('', 630, y, 500, { size: 36, bind: bind(`{${k}}`), fit: { lines: 2, min: 22 } })
      })
      b.image('logo-horizontal', 880, 715, { w: 250 })
    },
  },
  {
    key: 'bbq',
    name: 'BBQ / événement avec participation',
    build(b) {
      b.form([
        text('title', 'Titre', 'Lorem ipsum dolor'),
        text('date', 'Date', '2026-06-25', 'date'),
        text('time', 'Heure de début', '12:00', 'time'),
        text('place', 'Lieu', 'Lorem ipsum dolor'),
        text('menu', 'Au menu', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod…', 'textarea'),
        text('fee', 'Participation aux frais', 'Lorem ipsum dolor sit'),
        text('punch', 'Punchline (bas de l’écran)', 'Lorem ipsum dolor sit amet !'),
      ])
      b.rect(0, 0, W, H, C.white)
      b.rect(0, 0, W, 190, C.gold)
      b.text('', 40, 52, 1120, { size: 84, font: F.title, align: 'center', bind: bind('{title}', true) })
      b.rect(70, 230, 600, 130, C.ink)
      b.text('', 90, 250, 560, { size: 44, font: F.title, fill: C.white, bind: bind('{date|long}', true) })
      b.text('', 90, 305, 560, { size: 36, fill: C.white, bind: bind('{time|des}', true) })
      b.text('', 710, 255, 420, { size: 40, font: F.title, bind: bind('{place}', true), fit: { lines: 2, min: 24 } })
      b.text('AU MENU', 70, 400, 600, { size: 30, font: F.title })
      b.text('', 70, 445, 1060, { size: 40, bind: bind('{menu}', true), fit: { lines: 3, min: 24 } })
      b.rect(70, 600, 1060, 90, C.cream)
      b.rect(70, 600, 14, 90, C.gold)
      b.text('', 110, 622, 990, { size: 36, font: F.title, bind: bind('Participation : {fee}', true) })
      b.rect(0, 725, W, 100, C.gold)
      b.text('', 40, 752, 1120, { size: 42, font: F.title, align: 'center', bind: bind('{punch}', true) })
    },
  },
  {
    key: 'journee-collective',
    name: 'Journée collective (ménage, Noël…) + QR',
    build(b) {
      b.form([
        text('title', 'Titre', 'Lorem ipsum dolor sit'),
        text('date', 'Date', '2026-05-23', 'date'),
        text('time', 'Heure de début', '10:00', 'time'),
        text('p1', 'Programme 1', 'Lorem ipsum dolor'),
        text('p2', 'Programme 2', 'Consectetur adipiscing'),
        text('p3', 'Programme 3', 'Sed do eiusmod tempor'),
        text('note', 'Petite phrase', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod !', 'textarea'),
        text('url', 'Lien d’inscription (QR)', 'https://example.com'),
      ])
      b.rect(0, 0, W, H, C.white)
      b.text('', 70, 45, 900, { size: 66, font: F.title, bind: bind('{title}', true), fit: { lines: 1, min: 36 } })
      b.image('icone', 1030, 35, { h: 110 })
      b.rect(70, 160, 800, 100, C.ink)
      b.text('', 95, 183, 760, { size: 40, font: F.title, fill: C.white, bind: bind('{date|long} {time|des}', true), fit: { lines: 1, min: 24 } })
      b.text('AU PROGRAMME', 70, 305, 700, { size: 30, font: F.title })
      ;['p1', 'p2', 'p3'].forEach((k, i) => bullet(b, 80, 355 + i * 80, 760, 40, `{${k}}`))
      b.text('', 70, 625, 760, { size: 34, bind: bind('{note}'), fit: { lines: 3, min: 22 } })
      b.qr(900, 300, 250, 'https://example.com', '{url}')
      b.text('S’INSCRIRE', 900, 570, 250, { size: 28, font: F.title, align: 'center' })
    },
  },
  {
    key: 'merci',
    name: 'Merci / bravo',
    build(b) {
      b.form([
        text('name', 'Prénom ou équipe', 'Lorem ipsum'),
        text('message', 'Message', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do.', 'textarea'),
      ])
      b.rect(0, 0, W, H, C.cream)
      b.image('icone', 80, 160, { h: 480 })
      b.text('MERCI', 620, 150, 520, { size: 150, font: F.display, align: 'left' })
      b.text('', 620, 330, 520, { size: 80, font: F.title, bind: bind('{name} !', true), fit: { lines: 1, min: 36 } })
      b.text('', 620, 450, 520, { size: 40, bind: bind('{message}', true), fit: { lines: 4, min: 24 } })
      b.text('LE POULAILLER · COWORKING METZ', 70, 772, 1060, { size: 22, fill: '#8a8f8d' })
    },
  },
]
