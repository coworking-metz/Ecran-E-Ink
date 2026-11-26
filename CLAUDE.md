# Projet : écran e-ink Waveshare 9,7" piloté par un Pi Zero W via une API web

Dépôt public. Les notes internes (accès, Wi-Fi, chemins du Drive, détails du client SSO) sont dans `CLAUDE.local.md` (non versionné) : ne rien copier de ce fichier ici.

## Objectif
Un Pi Zero W branché à une dalle e-ink affiche texte + images récupérés sur une API web (le Pi est connecté à internet).
- **Backend Node** : API + stockage des créations et des écrans.
- **Dashboard admin** : éditeur façon calques (texte, images, formes, QR) dans un canvas aux dimensions exactes de l'écran, templates et saisie par formulaire.
- **Client Pi** : récupère l'image à afficher et la pousse sur l'écran (à faire).

## Matériel
- **Raspberry Pi Zero W v1.1** : ARMv6, 512 Mo RAM, Wi-Fi **2,4 GHz uniquement**.
- **Waveshare driver HAT IT8951** (broches HRDY/RST/CS/SCK/MOSI/MISO/GND/5V, flash SPI), bus **SPI**.
- **Dalle E-Ink ED097TC2 = 9,7"**, **1200 × 825 px**, 16 niveaux de gris, pas de couleur.
- **VCOM = -1.81 V** (étiquette sur la nappe de la dalle). À passer au driver à l'init, jamais une autre valeur.
- Alim : bloc 5V **≥ 2,5 A** (pas un port USB de PC). Ne jamais brancher/débrancher la nappe à chaud.

## Décisions d'architecture
- **Le Pi ne fait presque rien** : il récupère une PNG prête à afficher (1200×825, gris 8 bits) et l'envoie à l'IT8951.
- **Client Pi en Python** (pas Node : pas de build officiel ARMv6). Lib IT8951 en SPI (ex. GregDMeyer/IT8951 ou démo Waveshare). Daemon systemd qui poll `GET /api/device/current`, compare le hash, ne télécharge que si changé, puis met l'écran en veille.
- **Rendu côté navigateur** : l'éditeur (Konva) exporte la PNG à la taille native et l'envoie au serveur avec le JSON de scène. Pas de moteur de rendu serveur en v0 (WYSIWYG garanti). À reprendre avec `@napi-rs/canvas` si on veut du contenu dynamique (heure, météo).
- Le serveur normalise la PNG : fond blanc, resize exact, niveaux de gris 8 bits (`sharp`).
- **Auth admin** : SSO via le WordPress du coworking (voir plus bas) ; mot de passe unique (`ADMIN_PASSWORD`) seulement si le SSO n'est pas configuré. **Auth écrans** : token aléatoire par device. Les `/assets/:id.png` sont servis sans auth (ressources de l'éditeur).

## Code (monorepo npm workspaces)
```
server/   Fastify 5 + node:sqlite (intégré à Node 22) + sharp ; données dans server/data (ignoré par git)
admin/    Vite + React 18 + react-konva ; build dans admin/dist servi par le serveur
brand/images/   visuels de la charte rognés (logos, icône, ninja, fond fresque), semés dans la bibliothèque au démarrage
scripts/import-brand.mjs   réimporte visuels + polices depuis le dossier Communication du coworking
pi/       (vide) client Python + install.sh + service systemd : À FAIRE
```
Commandes : `npm install` ; `npm run dev` (serveur + Vite :5173 avec proxy) ; `npm run build` ; `npm start`.
Config : copier `.env.example` en `.env`. Le port se règle avec `EINK_PORT` (et non `PORT`, trop souvent déjà défini dans le shell) ; le proxy Vite lit le même `.env`.
Sans SSO, `ADMIN_PASSWORD` est le mot de passe admin (défaut `admin` avec un avertissement au démarrage).

### API
Admin (session SSO, ou Bearer = mot de passe sans SSO) : `GET|POST /api/creations` ; `GET|PUT|DELETE /api/creations/:id` (PUT accepte `{name, scene, png: dataURL, is_template}`) ; `POST /api/creations/:id/duplicate` ; `GET /api/creations/:id/image` ; `GET|POST /api/assets` (multipart) ; `DELETE /api/assets/:id` ; `GET|POST /api/devices` ; `PATCH|DELETE /api/devices/:id` (`refresh_seconds`, `name`) ; playlist : `POST /api/devices/:id/slides`, `PATCH|DELETE /api/slides/:id`, `PUT /api/devices/:id/slides/order` ; `GET|PUT /api/settings`.
Auth : `GET /api/auth/config`, `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/auth/login` et `GET /api/auth/callback` (SSO), `POST /api/login` (mot de passe, désactivé en SSO).
Pi (Bearer = token du device) : `GET /api/device/current` → `{hash, image_url, next_check_seconds, slide_id, slide_count, …}` (met à jour `last_seen`) ; `GET /api/device/image?creation=<id>` → PNG (limité aux créations de la playlist de l'écran).

### SSO WordPress (`server/src/auth.js`)
- Flux **Authorization Code + PKCE (S256), client public sans secret**, entièrement côté serveur : les jetons WordPress ne vont jamais au navigateur, qui ne reçoit qu'un cookie de session signé (HMAC-SHA256, `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS, 7 jours par défaut).
- Prérequis côté WordPress (plugin WP OAuth Server) : un client **sans secret**, grant `authorization_code`, avec comme redirect URI `<PUBLIC_URL>/api/auth/callback`.
- Variables : `WP_URL`, `WP_CLIENT_ID`, `PUBLIC_URL` (URL de l'admin vue par le navigateur), `SESSION_SECRET` (`openssl rand -hex 32`), `SSO_ALLOWED_ROLES` (défaut `admin`, rôles renvoyés par `/oauth/me`), `SESSION_DAYS`. Si `WP_URL`, `WP_CLIENT_ID` et `SESSION_SECRET` sont tous définis, le SSO est actif et la connexion par mot de passe est désactivée.
- Le serveur vérifie `state` (anti-CSRF de connexion), envoie le défi PKCE, puis contrôle les rôles de l'utilisateur avant d'ouvrir la session.

### Playlist (`server/src/playlist.js`)
- Un écran a une **playlist** de slides (`playlist_items` : création, position, durée, début, fin, actif). Les slides actifs défilent dans l'ordre, chacun pendant sa durée (propre au slide, sinon `default_slide_seconds` des options ; plancher 30 s pour ménager l'e-ink).
- **Le serveur choisit le slide du moment**, le Pi reste simple : rotation alignée sur l'horloge (`epoch mod durée totale`), donc sans état, identique pour tous les écrans, et qui survit aux redémarrages. `next_check_seconds` = fin du créneau (ou prochain début/fin de période), plafonné par `refresh_seconds` du device pour que les modifications du dashboard arrivent.
- Dates en ISO UTC en base, saisies en heure locale dans le dashboard (`admin/src/dates.js`) ; la fin est exclusive.
- Aucun slide actif : le **slide de repli** des options (`fallback_creation_id`), sinon l'écran garde sa dernière image.
- L'ancien modèle (une création par écran, `devices.creation_id`) est migré au démarrage en premier slide ; la colonne n'est plus utilisée.

### Dashboard
Pages : Créations (créations + templates, aperçus), Éditeur, Écrans (token, playlist, dernier passage), Options (durée par défaut, slide de repli).
Éditeur : calques texte, image, forme et QR ; déplacement/redimensionnement/rotation, ordre, duplication, suppression, flèches/Suppr/Ctrl+S, aperçu e-ink en niveaux de gris, export PNG, « Ajouter à la playlist de… » un écran.
Scène JSON : `{width, height, background, form?:{fields}, layers:[{id,type:'text'|'image'|'rect'|'qr',x,y,width,rotation,opacity,...}]}`.
Pas de `prompt()` à la création : une création/un écran se crée directement avec un nom par défaut, modifiable ensuite.
Voir le dashboard sans navigateur ouvert : `npm run screenshot -- /devices out.png --seed demo` (serveur jetable + Chrome headless). L'interaction à la souris (drag, redimensionnement) n'a pas été testée.

## Charte, polices, templates
- Palette : jaune `#EAB234`, vert-noir `#374140`, noir `#2A2C2B`, bleu `#2962FF`, crème `#F7E0AE`. Le jaune devient un gris clair sur l'écran : l'utiliser en aplats, jamais en texte fin.
- **Polices** : Eveleth Clean (titres), Eveleth Clean Thin (texte), Andalusia (script du logo), Blida (Light/Medium/Heavy), Track (+Italic), Aldo the Apache (**sans accents**). Déclarées dans `admin/src/styles.css`, listées dans `admin/src/fonts.js`, chargées avant le rendu du canvas. **Les fichiers de police ne sont PAS dans le dépôt** (copyright « All rights reserved », pas de licence de redistribution) : `admin/public/fonts/` est ignoré par git, voir le README de ce dossier. Sans eux, l'éditeur retombe sur une police système.
- **Templates** : `server/src/templates.js` (14 templates, textes d'exemple en lorem ipsum), semés dans la base au démarrage par `server/src/brand.js` (idempotent). Un template livré **non modifié** est mis à jour automatiquement si le code change (empreinte `template_hash`) ; un template retouché n'est jamais écrasé. Colonnes : `creations.is_template/template_key/template_hash`, `assets.brand_key`.
- **Liste** : accueil, événement, petit déjeuner, annonce sombre, infos pratiques (Wi-Fi/horaires), agenda de la semaine, message sur fresque, avis de recherche, logo plein écran (veille), consigne du lieu, QR code d'action, BBQ / événement avec participation, journée collective + QR, merci/bravo.
- **Aperçus** : les templates livrés n'ont pas d'image au départ ; la page Créations les rend côté navigateur (`renderScenePng`, même moteur Konva que l'éditeur) puis les enregistre.
- **Mode formulaire** : un template déclare des champs (`scene.form.fields` : text/textarea/date/time) et lie des calques texte/QR via `bind: {tpl, upper}` (ex. `{date|long} {time|des}`). Formats : long, weekdayShort, day, time, des (`admin/src/form.js`). La taille du texte se réduit automatiquement (`fit: {lines, min}`). L'éditeur s'ouvre en mode Formulaire (saisie + aperçu en direct) avec bascule vers le mode Calques ; un calque lié peut être « détaché ».
- **Calque QR** : généré dans le navigateur (`qrcode`), noir sur blanc, à la taille exacte du calque.
- `npm run build` : le bundle Vite est dans `admin/dist/app/` (et non `assets/`, dossier des images importées servi par le serveur : collision corrigée).

## Déploiement (production)
- **pm2** : `ecosystem.config.cjs` (un seul process en mode fork : SQLite ne se met pas en cluster). Node >= 22 requis ; si le Node système est plus ancien, installer Node 22 à côté et lancer avec `EINK_NODE=<chemin du node 22>`. Piège : `npm` relance `node` via le `PATH`, donc préfixer le `PATH` avec le dossier `bin` de Node 22 (le script le fait).
- **Mise à jour** : `./scripts/deploy.sh` sur le serveur (sauvegarde optionnelle si `EINK_BACKUP_DIR` est défini, `git pull --ff-only`, `npm ci`, build, `pm2 startOrReload`, `pm2 save`).
- **Reverse proxy** : l'app écoute sur `127.0.0.1:<EINK_PORT>` (défaut `127.0.0.1`, `EINK_HOST` pour changer) ; ne jamais l'exposer directement. Apache : `ProxyPass / http://127.0.0.1:<port>/` avec `ProxyPreserveHost On` et `ProxyPass /.well-known/acme-challenge !` pour certbot ; HTTPS obligatoire (cookie de session `Secure`, `PUBLIC_URL` en https).
- **Données** : une base SQLite (`eink.db`, mode WAL) + des images (`creations/<id>.png`, `assets/<id>.png`) dans `DATA_DIR` (défaut `server/data`). En production, mettre `DATA_DIR` **hors du dépôt**. Sauvegarde cohérente : `./scripts/backup.sh <dossier>` (`VACUUM INTO`, un `cp` de la base pendant que l'app tourne peut être incohérent à cause du WAL).
- Les polices ne sont pas dans le dépôt : à copier à la main dans `admin/public/fonts/` **avant** le build (Vite les embarque dans `dist`).

## À faire
1. **Matériel** : flasher une carte SD (Raspberry Pi OS Lite 32-bit), activer SPI, brancher HAT + dalle (Pi éteint), installer la lib IT8951, `pi/test_display.py` (1200×825, VCOM -1.81, mire de gris + texte), mesurer les temps de refresh (GC16 qualité vs DU rapide).
2. Écrire le **client Pi** (`pi/client.py`, config fichier : URL, token, VCOM, rotation ; `install.sh` ; service systemd ; reprise après coupure réseau).
3. Tester l'éditeur à la souris, et la connexion SSO de bout en bout avec un vrai compte.
4. Déployer le backend (HTTPS, `PUBLIC_URL` de production à enregistrer comme redirect URI côté WordPress).
5. Plus tard : rendu serveur/widgets dynamiques, plusieurs écrans, planning de contenu.

## Questions ouvertes
- Hébergement du backend.
- Orientation : paysage (natif 1200×825) ou portrait (rotation logicielle).
