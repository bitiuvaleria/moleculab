# MolécuLab

Appli web qui part d'une structure chimique (SMILES, fichier MOL/SDF, ou nom de
molécule) et en déduit un dossier en quatre étapes enchaînées :

1. **Chimie** — identité, descripteurs, ionisation à pH 7,4
2. **Pharmacocinétique** — absorption, distribution, élimination, simulateur de courbe
3. **Métabolisme** — voies probables, métabolites dessinés
4. **Toxicologie** — alertes structurales, organes cibles

Chaque étape reçoit les résultats des précédentes. Une molécule qui n'existe pas
est acceptée : tout est prédit à partir de la structure.

## Ce qui est calculé et ce qui est prédit

Calculé dans le navigateur par [OpenChemLib](https://github.com/cheminfo/openchemlib-js)
8.14.0 (donc vérifiable et reproductible) : formule, masses, logP, logS, TPSA,
donneurs/accepteurs de liaisons H, liaisons rotatives, règles de Lipinski et de
Veber, centres ionisables, ionisation et logD à pH 7,4, dessin des structures,
courbe concentration-temps.

Prédit par le modèle : tout le reste. Chaque valeur porte un niveau de preuve
(A : mesurée chez l'humain · B : publiée · C : prédite à partir de la structure)
et la source ou la règle employée.

## Architecture

Un seul fichier d'appli, `index.html`, sans build ni dépendance à installer.
Il interroge Claude de deux façons :

- **si `config.js` donne une adresse de serveur** (`window.MOLECULAB_API`), il
  passe par ce serveur, qui détient la clé d'API. Les visiteurs n'ont alors
  besoin de rien : ni compte, ni clé.
- **sinon**, il utilise le compte Claude de la personne qui ouvre la page
  (capacité `sample`), ce qui ne fonctionne que si la page est servie comme
  artefact claude.ai.

> La clé d'API n'est jamais dans la page. Un site statique est intégralement
> lisible par ses visiteurs : une clé posée dans `config.js`, dans `index.html`
> ou dans le dépôt serait publique, utilisable par n'importe qui, et facturée au
> propriétaire du compte. C'est la seule raison d'être du serveur ci-dessous.

## Déploiement

### 1. Le serveur qui garde la clé (Cloudflare Workers, offre gratuite)

Le plus simple : laisser Cloudflare lire le code dans ce dépôt. Le fichier
`wrangler.jsonc` à la racine lui dit quoi déployer.

1. Créer un compte sur [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Compute (Workers) → Create → Import a repository**, autoriser GitHub,
   choisir `bitiuvaleria/moleculab`, branche `main`, et déployer. Laisser les
   commandes de build vides.
3. Régler ensuite les variables (tableau ci-dessous), dans **Settings →
   Variables and Secrets** du Worker. `ORIGINE` et `MODELE` sont déjà posés par
   `wrangler.jsonc` ; seuls les deux secrets restent à ajouter.

À chaque `git push` sur `main`, Cloudflare redéploie le serveur tout seul.

#### Variante : coller le code à la main

1. Créer un compte sur [dash.cloudflare.com](https://dash.cloudflare.com), puis
   **Compute (Workers) → Create → Start from Hello World → Deploy**.
2. Ouvrir le Worker, bouton **Edit code** (en haut à droite), tout remplacer
   par le contenu de [`worker/moleculab-worker.js`](worker/moleculab-worker.js),
   puis **Deploy**.
3. **Settings → Variables and Secrets** :

   | Nom | Type | Valeur |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Secret | la clé d'API, `sk-ant-…`, depuis [console.anthropic.com](https://console.anthropic.com) |
   | `CODE_CLASSE` | Secret | un mot de passe commun, au choix. Vide = site ouvert à tous |
   | `ORIGINE` | Text | l'adresse du site, par exemple `https://bitiuvaleria.github.io` |
   | `MODELE` | Text | `claude-opus-5-5` (le plus fin) ou `claude-sonnet-5-5` (moins cher) |

4. Noter l'adresse du Worker : `https://…​.workers.dev`.

Le Worker ne fait rien d'autre que recevoir une demande du site, y ajouter la
clé, et renvoyer la réponse de Claude au fur et à mesure qu'elle s'écrit. Il
refuse les demandes sans le bon `CODE_CLASSE`, celles qui dépassent 60 000
caractères, et n'accepte que trois modèles.

### 2. Le site (GitHub Pages)

1. Mettre l'adresse du Worker dans `config.js` :
   `window.MOLECULAB_API = "https://…​.workers.dev";`
2. **Settings → Pages** du dépôt : Source *Deploy from a branch*, branche
   `main`, dossier `/ (root)`, **Save**.
3. Le site est servi sur `https://<utilisateur>.github.io/moleculab/`.

Si un `CODE_CLASSE` est configuré, partager le lien avec le code :
`https://…/moleculab/?code=LECODE`. Le navigateur le retient ensuite.

## Coût

Une analyse complète = quatre appels à l'API, soit de l'ordre de 4 000 à 5 000
jetons d'entrée et quelques milliers en sortie par appel. Les tarifs par million
de jetons sont sur [anthropic.com/pricing](https://www.anthropic.com/pricing) ;
`claude-sonnet-5-5` coûte nettement moins que `claude-opus-5-5` pour un rendu
très proche sur ce type de tâche. Un plafond mensuel se règle dans la console
Anthropic (**Settings → Limits**), ce qui évite toute mauvaise surprise si le
lien circule plus que prévu.

## Avertissement

Outil d'apprentissage et de recherche. Les valeurs de niveau C sont des
prédictions, pas des données. Aucune décision clinique ne doit s'appuyer
dessus.
