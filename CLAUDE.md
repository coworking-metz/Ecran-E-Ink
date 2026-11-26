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
Routes : `server/src/index.js` (`adminOnly` = session SSO, ou mot de passe en Bearer si le SSO n'est pas configuré ; `deviceOnly` = jeton d'écran).
Pi (Bearer = token du device) : `GET /api/device/current` → `{hash, image_url, version, next_check_seconds, slide_id, slide_count, …}` (met à jour `last_seen`) ; `GET /api/device/image?creation=<id>` → PNG finale (limité aux créations de la playlist de l'écran).

### Long-polling (`server/src/hub.js`)
- `GET /api/device/current?wait=<s>&v=<version>&shown=<hash>` : le serveur retient la réponse jusqu'à un changement du dashboard (le hub réveille les écrans concernés), la fin du créneau du slide en cours, ou `wait` s (45 max : Cloudflare coupe à 100 s). Sans `v`, ou avec une version périmée (autre `bootId` après un redémarrage), réponse immédiate. Les anciens clients (sans `wait`) gardent `next_check_seconds`.
- État en mémoire : un seul process serveur (pm2 en mode fork). `shown` = hash de ce que le Pi affiche, visible dans la page Écrans (en ligne, « affiche : … »).
- Client (`pi/client.py`) : regroupe les modifications rapprochées (`settle_seconds`) et espace les rafraîchissements (`min_redraw_gap_seconds`, usure de la dalle) ; sort tout de suite sur SIGTERM. Testé contre le vrai serveur avec un faux pilote (`pi/tests/fake`, `server/test/pi-client.test.js`, ignoré sans Python + Pillow).

### Calibrage du passe-partout (`server/src/screen.js`)
- Réglage global `margins` (px haut/droite/bas/gauche, 0–200) dans la page **Calibrage**. Le **canvas des slides = écran moins les marges** ; les créations sont stockées à cette taille et le serveur les **centre dans un cadre noir 1200×825 à la livraison** (`composeFinal`), donc un changement de marges s'applique tout de suite à tous les slides sans les ré-enregistrer (au besoin un slide d'une autre taille est étiré dans la zone utile).
- L'empreinte envoyée au Pi inclut les marges (`finalHash`) ; sans marge, elle est inchangée (aucun retéléchargement).
- Les scènes conçues à une autre taille (anciens slides, templates en 1200×825) sont remises à l'échelle à l'ouverture dans l'éditeur (`admin/src/sceneFit.js` : positions proportionnelles, texte et QR à l'échelle uniforme, fond plein cadre recalé).
- **Mire de calibrage** (`POST /api/calibration`) : cadre, graduations et cotes affichés sur l'écran réel, 15 min max (état en mémoire). Elle remplace temporairement la playlist.
- Les assertions de pixel de `server/test/screen.test.js` sont au pixel près : un décalage d'un pixel doit faire échouer.

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
- **Afficher ce slide maintenant** (`POST /api/slides/:id/show`, 409 si le slide n'est pas actif) : on décale la **phase** de la rotation de l'écran (`devices.phase_offset_ms`, `offsetToShow`) pour que ce slide commence à l'instant T ; la rotation continue ensuite avec les suivants dans l'ordre (pas une surcharge temporaire).
- **Forcer le rafraîchissement** (`POST /api/devices/:id/refresh`) : compteur `refresh_nonce` ; le Pi qui voit un nouveau compteur **efface puis redessine** l'écran (rémanences), même image, et confirme avec `?nonce=` (`refreshed_nonce` → `refresh_pending` dans le dashboard). Au premier passage le Pi adopte le compteur sans rien forcer.

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
- **Aperçus** : les templates livrés n'ont pas d'image au départ ; la page Créations les rend côté navigateur (`renderScenePng`, même moteur Konva que l'éditeur) puis les enregistre.
- **Mode formulaire** : un template déclare des champs (`scene.form.fields` : text/textarea/date/time) et lie des calques texte/QR via `bind: {tpl, upper}` (ex. `{date|long} {time|des}`). Formats : long, weekdayShort, day, time, des (`admin/src/form.js`). La taille du texte se réduit automatiquement (`fit: {lines, min}`). L'éditeur s'ouvre en mode Formulaire (saisie + aperçu en direct) avec bascule vers le mode Calques ; un calque lié peut être « détaché ».
- **Calque QR** : généré dans le navigateur (`qrcode`), noir sur blanc, à la taille exacte du calque.
- `npm run build` : le bundle Vite est dans `admin/dist/app/` (et non `assets/`, dossier des images importées servi par le serveur : collision corrigée).

## Déploiement (production)
- **pm2** : `ecosystem.config.cjs` (un seul process en mode fork : SQLite ne se met pas en cluster). Node >= 22 requis ; si le Node système est plus ancien, installer Node 22 à côté et lancer avec `EINK_NODE=<chemin du node 22>`. Piège : `npm` relance `node` via le `PATH`, donc préfixer le `PATH` avec le dossier `bin` de Node 22 (le script le fait).
- **Mise à jour** : `./scripts/deploy.sh` sur le serveur (sauvegarde optionnelle si `EINK_BACKUP_DIR` est défini, `git pull --ff-only`, `npm ci`, build, `pm2 startOrReload`, `pm2 save`).
- **Reverse proxy** : l'app écoute sur `127.0.0.1:<EINK_PORT>` (défaut `127.0.0.1`, `EINK_HOST` pour changer) ; ne jamais l'exposer directement. Apache : `ProxyPass / http://127.0.0.1:<port>/` avec `ProxyPreserveHost On` et `ProxyPass /.well-known/acme-challenge !` pour certbot ; HTTPS obligatoire (cookie de session `Secure`, `PUBLIC_URL` en https).
- **Données** : une base SQLite (`eink.db`, mode WAL) + des images (`creations/<id>.png`, `assets/<id>.png`) dans `DATA_DIR` (défaut `server/data`). En production, mettre `DATA_DIR` **hors du dépôt**. Sauvegarde cohérente : `./scripts/backup.sh <dossier>` (`VACUUM INTO`, un `cp` de la base pendant que l'app tourne peut être incohérent à cause du WAL).
- **Cloudflare** est devant le site : il renvoie 403 au `User-Agent` par défaut de Python (`urllib`). Le client du Pi envoie toujours `eink-pi/1` ; tout nouveau client HTTP doit fixer le sien.
- Les polices ne sont pas dans le dépôt : à copier à la main dans `admin/public/fonts/` **avant** le build (Vite les embarque dans `dist`).

## À faire
1. **Écran** : confirmer l'affichage à l'œil (`pi/test_display.py` validé côté logiciel : dalle 1200×825, VCOM -1.81, GC16 ≈ 1,3 s), installer le service (`pi/install-service.sh`), tester un cycle complet avec plusieurs slides, mesurer le mode rapide (DU) si besoin.
2. Valider `pi/client.py` sur le matériel réel (testé jusqu'ici contre un serveur local avec un faux pilote, et contre la prod depuis le Pi pour l'API).
3. Tester l'éditeur à la souris (déplacement, redimensionnement, rotation).
4. Sauvegarde planifiée de la prod (`scripts/backup.sh` en cron), SSH du Pi par clé seulement.
5. Plus tard : rendu serveur/widgets dynamiques (heure, météo), plusieurs écrans avec contenus différents, récurrence des slides (ex. « chaque premier jeudi »).

## Question ouverte
- Orientation : paysage (natif 1200×825) ou portrait (rotation logicielle).
