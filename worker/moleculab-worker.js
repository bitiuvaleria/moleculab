/**
 * MolécuLab — petit serveur qui garde la clé d'API.
 *
 * À déployer sur Cloudflare Workers (offre gratuite). Il ne fait qu'une chose :
 * recevoir une demande d'analyse venue du site, y ajouter la clé d'API, et
 * renvoyer la réponse de Claude au fur et à mesure qu'elle s'écrit.
 *
 * La clé n'est jamais dans la page : elle vit ici, côté serveur, dans une
 * variable secrète que personne ne peut lire depuis un navigateur.
 *
 * Variables à régler dans Cloudflare (Settings → Variables and Secrets) :
 *   ANTHROPIC_API_KEY  (secret, obligatoire)  la clé, sk-ant-...
 *   CODE_CLASSE        (secret, conseillé)    mot de passe commun ; si vide, le site est ouvert à tous
 *   ORIGINE            (variable, conseillé)  l'adresse du site, ex. https://bitiuvaleria.github.io
 *   MODELE             (variable, facultatif) modèle par défaut
 */

const MODELES = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const MODELE_DEFAUT = "claude-opus-5-5";
const MAX_PROMPT = 60000;

function cors(env, extra) {
  const o = (env.ORIGINE || "*").trim();
  return {
    "access-control-allow-origin": o,
    "access-control-allow-headers": "content-type, x-code-classe",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    ...extra
  };
}
const erreur = (env, code, message, status) =>
  new Response(JSON.stringify({ erreur: code, message }), {
    status, headers: cors(env, { "content-type": "application/json; charset=utf-8" })
  });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    if (request.method !== "POST") return erreur(env, "methode", "Utilise POST.", 405);
    if (!env.ANTHROPIC_API_KEY) return erreur(env, "config", "La clé d'API n'est pas configurée sur le serveur.", 500);

    if (env.CODE_CLASSE && request.headers.get("x-code-classe") !== env.CODE_CLASSE)
      return erreur(env, "code_classe", "Code de classe absent ou incorrect.", 401);

    let corps;
    try { corps = await request.json(); } catch (e) { return erreur(env, "requete", "Corps de requête illisible.", 400); }

    const prompt = typeof corps.prompt === "string" ? corps.prompt : "";
    if (!prompt.trim()) return erreur(env, "requete", "Aucune demande reçue.", 400);
    if (prompt.length > MAX_PROMPT) return erreur(env, "trop_long", "Demande trop longue.", 413);

    const modele = MODELES.includes(corps.modele) ? corps.modele : (MODELES.includes(env.MODELE) ? env.MODELE : MODELE_DEFAUT);

    /* On demande la réponse en flux : elle arrive morceau par morceau, donc rien
       n'expire pendant que Claude réfléchit, même une minute ou deux. */
    const amont = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2026-10-21"
      },
      body: JSON.stringify({
        model: modele,
        max_tokens: 16000,
        stream: true,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!amont.ok || !amont.body) {
      let detail = "";
      try { detail = ((await amont.json())?.error?.message) || ""; } catch (e) {}
      const code = amont.status === 401 ? "cle_refusee"
        : amont.status === 429 ? "trop_de_demandes"
        : amont.status === 400 ? "requete"
        : "api";
      return erreur(env, code, detail || ("L'API a répondu " + amont.status + "."), amont.status === 401 ? 502 : amont.status);
    }

    return new Response(amont.body, {
      headers: cors(env, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store"
      })
    });
  }
};
