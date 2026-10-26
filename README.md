# MolécuLab

Application web d'analyse d'une molécule à partir de sa **DCI** ou de son **SMILES** : chimie,
métabolisation, toxicologie et pharmacocinétique, chaque valeur affichée avec sa source nommée et
son niveau de preuve. Projet d'UEL.

Outil pédagogique. Une valeur de niveau C est une prédiction : elle n'a pas de valeur clinique.

## Ce que fait l'application

Le cheminement est imposé et visible pendant l'analyse :

1. identité et SMILES canonique ;
2. chimie à partir de la structure (fonctions chimiques, masse molaire, pKa, lipophilie, solubilité) ;
3. métabolites de phase I et II déduits de la structure ;
4. toxicité de la molécule mère **et de chaque métabolite majeur**, à partir des éléments
   structuraux porteurs de risque ;
5. pharmacocinétique.

Trois principes d'affichage :

- **Une rubrique, plusieurs sources.** Un paramètre n'est pas une valeur mais une liste
  d'assertions. Deux sources qui divergent restent toutes deux affichées, avec un drapeau.
- **Niveau de preuve sur chaque ligne.** A = valeur humaine mesurée (RCP, base publique des
  médicaments), B = publication, C = prédiction ou calcul structural.
- **Pas de dose en entrée.** Cmax, AUC et Css sont donnés normalisés par la dose, puisque
  AUC = F·D/CL. Tmax, qui ne dépend que de ka et ke, reste calculable.

## Mise en route

Le site est statique : aucun serveur, aucune compilation.

```bash
# en local
python3 -m http.server 8000     # puis http://localhost:8000
```

Pour lancer une analyse, ouvrir l'onglet **Réglages** et coller une clé d'API Anthropic. Elle est
conservée dans le stockage local du navigateur et envoyée uniquement à `api.anthropic.com`.

> Une clé posée dans un navigateur convient à un usage personnel et à une démonstration. Pour un
> site ouvert à d'autres, il faut un petit serveur qui garde la clé — voir « Étapes suivantes ».

## Structure

```
index.html        la page unique, quatre onglets
css/style.css     tokens de couleur, thème clair et sombre, composants
js/app.js         saisie, appel du moteur, rendu des fiches, corrections
```

## Corrections

Chaque ligne d'une fiche porte un lien *corriger*. Une correction enregistre la valeur juste, sa
source et un commentaire ; elle est conservée dans le navigateur, elle prime sur toute prédiction, et
elle est réinjectée dans le prompt à chaque nouvelle analyse de la même molécule. L'onglet
Corrections permet de les exporter et de les réimporter en JSON, pour les transporter d'un
navigateur à l'autre.

## Moteurs de référence

Les quatre moteurs retenus pour le projet n'acceptent pas d'être appelés depuis un autre site. Ils
sont donc ouverts depuis l'application avec le SMILES copié, et leur résultat se recolle dans le
champ « Importer un résultat d'outil », où il devient une source prioritaire.

| Outil | Rôle | Accès programmatique réel |
|---|---|---|
| [BioTransformer 3.0](https://bitbucket.org/wishartlab/biotransformer3.0jar/wiki/Usage) | métabolites, enzymes | exécutable Java en local, usage académique |
| [GLORYx](https://nerdd.univie.ac.at/gloryx) / [GLORYxR](https://github.com/molinfo-vienna/GLORYxR) | métabolites, score de priorité | paquet Python libre, GPL-3.0 |
| [ADMETlab 3.0](https://admetlab3.scbdd.com) | ADME, alertes | API officielle ([NAR 2024](https://academic.oup.com/nar/article/52/W1/W422/7642316)) |
| [ProTox 3.0](https://tox.charite.de/protox3/) | toxicité d'organe, toxicophores | interface POST documentée, 250 requêtes/jour/IP |
| [BDPM](https://base-donnees-publique.medicaments.gouv.fr/) | RCP français | fichiers publics téléchargeables |

## Étapes suivantes

1. **Un petit serveur** (FastAPI) qui garde la clé d'API, exécute RDKit, BioTransformer 3.0 et
   GLORYxR, et appelle les API de ProTox 3.0 et d'ADMETlab 3.0 avec une mise en cache — le quota de
   ProTox est de 250 requêtes par jour, et une molécule plus dix métabolites en consomment onze.
2. **Déduplication des métabolites par InChIKey** calculé par RDKit côté serveur, plutôt que par
   comparaison de structures décrite en langage naturel.
3. **Bilan des corrections par outil** : quel prédicteur se trompe, dans quel sens, sur quelle classe
   chimique. C'est ce qui transforme l'agrégateur en travail d'évaluation critique.
