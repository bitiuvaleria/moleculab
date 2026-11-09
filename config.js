/* Adresse du petit serveur qui détient la clé d'API (Cloudflare Worker).
   Tant que cette ligne est vide, le site calcule tout ce qui est local
   (dessin, descripteurs, ionisation, simulateur) mais ne peut pas analyser.

   Exemple : window.MOLECULAB_API = "https://moleculab.valeria.workers.dev";

   On ne met JAMAIS la clé d'API ici : ce fichier est public. */
window.MOLECULAB_API = "";

/* Modèle utilisé, facultatif. Vide = celui réglé sur le serveur.
   "claude-opus-5-5" = le plus fin, "claude-sonnet-5-5" = moins cher. */
window.MOLECULAB_MODELE = "";
