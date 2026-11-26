# Écran E-Ink

Écran e-ink du coworking **Le Poulailler** (Metz) : une dalle E-Ink 9,7" (Waveshare, 1200 × 825, 16 niveaux de gris) pilotée par un Raspberry Pi Zero W, qui affiche des visuels récupérés sur une API web.

- **`server/`** : backend Node (Fastify, SQLite) : API admin, API appelée par les écrans, stockage des créations.
- **`admin/`** : dashboard d'édition (React, Konva) : éditeur à calques, templates aux couleurs et polices de la charte, saisie par formulaire (dates, titres, QR code…), aperçu e-ink.
- **`brand/`** : visuels de la charte (logos, mascotte) utilisés par les templates.
- **`scripts/`** : import des visuels et polices de la charte.
- **`pi/`** : client Python pour le Raspberry Pi (à venir).

## Démarrage

```bash
npm install
cp .env.example .env     # puis renseigner ADMIN_PASSWORD (ou le SSO)
npm run dev              # serveur + dashboard (http://localhost:5173)
npm run build && npm start
```

Prérequis : Node 22 ou plus (SQLite intégré).

## Notes

- **Polices** : celles de la charte du coworking ne sont pas dans le dépôt (copyright, pas de licence de redistribution). Voir [`admin/public/fonts/README.md`](admin/public/fonts/README.md).
- **SSO** : l'accès admin se fait avec le compte WordPress du coworking (OAuth2, Authorization Code + PKCE, client public). Voir les variables `WP_URL`, `WP_CLIENT_ID`, `PUBLIC_URL`, `SESSION_SECRET` dans `.env.example`. Sans SSO configuré, un mot de passe (`ADMIN_PASSWORD`) est utilisé.
- Détails d'architecture, API et état du projet : voir [`CLAUDE.md`](CLAUDE.md).

## Licence

[MIT](LICENSE.md)
