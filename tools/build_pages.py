#!/usr/bin/env python3
"""Fabrique index.html (version hébergée sur GitHub Pages) à partir de la source
de l'artefact claude.ai.

Les deux versions sont la même appli ; seules deux choses changent :

1. l'enveloppe HTML. Un artefact claude.ai est servi sans <!doctype>, <html>,
   <head> ni <body> : la plateforme les ajoute. Une page servie par GitHub Pages
   doit les porter elle-même.
2. le moteur. L'artefact interroge Claude sur le compte du visiteur (capacité
   « sample »), ce à quoi une camarade de promo n'a pas droit. La version
   hébergée parle au petit Worker Cloudflare qui détient la clé d'API.

Le reste du fichier — prompts, calculs OpenChemLib, rendu — est strictement
identique dans les deux versions : il n'est jamais recopié à la main.

Usage : python3 tools/build_pages.py <source-artefact.html> [index.html]
"""
import pathlib
import sys

DEBUT = "let sampleP = null;"
FIN = "let BUSY = false;"

MOTEUR = r'''/* ---------------- moteur d'analyse ---------------- */
/* Version hébergée : les questions partent vers le petit serveur de MolécuLab
   (adresse dans config.js), qui détient la clé d'API. N'importe qui peut donc
   utiliser le site, sans compte Claude. Si aucune adresse n'est renseignée, on
   retombe sur le compte Claude du visiteur, comme dans l'artefact.
   La clé d'API n'est JAMAIS dans cette page : elle vit côté serveur. */
const API = (window.MOLECULAB_API || "").trim();
let MODE = null;

/* Mot de passe commun éventuel : accepté dans l'adresse (…/?code=XXXX),
   puis retenu dans le navigateur. */
function codeClasse() {
  const u = new URLSearchParams(location.search).get("code");
  if (u) { try { localStorage.setItem("mlab.code", u); } catch (e) {} return u; }
  try { return localStorage.getItem("mlab.code") || ""; } catch (e) { return ""; }
}

/* Claude répond en JSON, parfois entouré de texte ou de ```json : on isole l'objet. */
function extraireJSON(t) {
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw { code: "invalid_json" };
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { throw { code: "invalid_json" }; }
}

const limite = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r("__timeout__"), ms))]);

/* Le serveur renvoie la réponse morceau par morceau : rien n'expire pendant que
   Claude réfléchit, même une à deux minutes. On recolle le texte au passage. */
async function serveurJSON(prompt) {
  let r;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-code-classe": codeClasse() },
      body: JSON.stringify({ prompt, modele: (window.MOLECULAB_MODELE || "").trim() || undefined })
    });
  } catch (e) { throw { code: "serveur_injoignable" }; }
  if (!r.ok || !r.body) {
    let c = "serveur";
    try { c = (await r.json())?.erreur || c; } catch (e) {}
    throw { code: c };
  }
  const lec = r.body.getReader(), dec = new TextDecoder();
  let tampon = "", texte = "";
  for (;;) {
    const { done, value } = await lec.read();
    if (done) break;
    tampon += dec.decode(value, { stream: true });
    const lignes = tampon.split("\n");
    tampon = lignes.pop();
    for (const l of lignes) {
      if (!l.startsWith("data:")) continue;
      let ev; try { ev = JSON.parse(l.slice(5).trim()); } catch (e) { continue; }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") texte += ev.delta.text;
      if (ev.type === "error") throw { code: "serveur" };
    }
  }
  return extraireJSON(texte);
}

let moteurP = null;
function getMoteur() {
  return moteurP ||= (async () => {
    if (API) { MODE = "serveur"; return { json: serveurJSON }; }
    if (!window.claude?.use) return null;
    const s = await limite(window.claude.use("sample"), 15000)
      .then(v => (v === "__timeout__" ? null : v)).catch(() => null);
    if (!s) return null;
    MODE = "compte";
    return { json: p => s.json(p, { modelTier: "default" }) };
  })();
}
'''

ERR_ARTEFACT = '  pas_de_claude: "L\'analyse n\'a pas pu démarrer. Elle tourne sur le compte Claude de la personne qui ouvre la page : il faut être connecté à claude.ai dans ce navigateur, puis recharger. Un compte gratuit suffit.",'

ERR_SERVEUR = '''  pas_de_claude: "L'analyse n'a pas pu démarrer : aucun moteur n'est joignable. Si tu utilises la version hébergée, c'est que l'adresse du serveur n'est pas renseignée dans config.js.",
  serveur_injoignable: "Le serveur d'analyse ne répond pas. Vérifie ta connexion, puis relance l'étape.",
  serveur: "Le serveur d'analyse a renvoyé une erreur. Relance l'étape ; si ça persiste, préviens Valeria.",
  config: "Le serveur d'analyse n'a pas de clé d'API configurée. Rien à faire de ton côté : préviens Valeria.",
  code_classe: "Code de classe absent ou incorrect. Ouvre le lien complet qu'on t'a envoyé (celui qui finit par ?code=…).",
  requete: "La demande a été refusée par le serveur. Relance l'étape.",
  trop_long: "La demande envoyée est trop longue. Raccourcis le contexte clinique, puis relance.",
  cle_refusee: "La clé d'API du serveur est refusée (expirée, ou plus de crédit). Préviens Valeria.",
  trop_de_demandes: "Trop de demandes d'affilée sur le serveur. Attends une minute, puis relance l'étape.",
  api: "L'API de Claude a renvoyé une erreur. Relance l'étape dans un moment.",
'''


def construire(source: str) -> str:
    i, j = source.index(DEBUT), source.index(FIN)
    assert i < j, "bloc moteur introuvable"
    s = source[:i] + MOTEUR + source[j:]

    for a, b in (
        ("const sample = await getSample();", "const moteur = await getMoteur();"),
        ("if (!sample) {", "if (!moteur) {"),
        ('const r = await limite(sample.json(P[k](d), { modelTier: "default" }), 300000);',
         "const r = await limite(moteur.json(P[k](d)), 300000);"),
        ("getSample().then(s => {", "getMoteur().then(s => {"),
    ):
        assert a in s, a
        s = s.replace(a, b)
    assert "getSample" not in s and "sampleP" not in s

    assert ERR_ARTEFACT in s, "message pas_de_claude introuvable"
    s = s.replace(ERR_ARTEFACT, ERR_SERVEUR)
    s = s.replace(
        "Les descripteurs calculés, le dessin et le simulateur, eux, fonctionnent sans connexion.",
        "Les descripteurs calculés, le dessin et le simulateur, eux, fonctionnent quand même.")

    # enveloppe HTML : le <style> initial monte dans <head>, le reste va dans <body>
    fin_style = s.index("</style>") + len("</style>")
    tete = s[:fin_style].replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
    corps = s[fin_style:]
    return ('<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            + tete.strip()
            + '\n<script src="config.js"></script>\n</head>\n<body>\n'
            + corps.strip() + '\n</body>\n</html>\n')


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    cible = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "index.html")
    page = construire(src)
    cible.write_text(page, encoding="utf-8")
    print(f"{cible} écrit ({len(page)} caractères)")
