# Peek

## Serveur (VPS)
```sh
echo "PASSWORD=un-mot-de-passe-long" > .env
docker compose up -d --build
```
→ `http://IP-DU-VPS` (identifiant : n'importe quoi, mot de passe : celui du .env).
Images publiques : `http://IP-DU-VPS/img/<fichier>`. Sauvegarde : le dossier `data/`.

## Extension Chrome
`chrome://extensions` → Mode développeur → « Charger l'extension non empaquetée » → dossier `extension/`.
Puis Détails → Options de l'extension → URL du serveur + mot de passe.
Clic droit sur une image → Enregistrer sur Peek → catégorie. Badge ✓/✗ sur l'icône.
Plusieurs images : clic sur l'icône Peek → cocher les images de la page → catégorie → Enregistrer (le badge décompte).
Nouvelle catégorie créée sur le site → « ↻ Recharger les catégories » dans le menu.

## Test
`node test.mjs`
