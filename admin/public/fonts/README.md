# Polices de la charte

Les fichiers de polices ne sont **pas** versionnés : ils portent « Copyright … All rights reserved » et n'ont pas de licence de redistribution.

Fichiers attendus dans ce dossier (noms exacts, référencés par `src/styles.css`) :

`Blida-Light.ttf`, `Blida-Medium.ttf`, `Blida-Heavy.ttf`, `EvelethClean-Regular.otf`, `EvelethClean-Thin.otf`,
`Track.ttf`, `Track-Italic.ttf`, `Andalusia.ttf`, `AldoTheApache.ttf`

Pour les récupérer depuis le dossier Communication du coworking :

```bash
node scripts/import-brand.mjs "<chemin du dossier Communication>"
```

Sans ces fichiers, l'éditeur fonctionne mais retombe sur une police système.
