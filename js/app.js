/* MolécuLab — logique de l'application.
   Un seul fichier : saisie, appel du moteur d'analyse, rendu des fiches, corrections.
   L'analyse est découpée en trois appels courts plutôt qu'un seul très long : une réponse
   trop longue arrivait tronquée, donc illisible, et la page restait vide sans rien dire. */
"use strict";

/* ---------------------------------------------------------------- utilitaires */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = s => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "").slice(0, 60) || "x";

/* ---------------------------------------------------------------- stockage local */
const LS = {
  get(k, dflt) { try { const v = localStorage.getItem("moleculab." + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
  set(k, v) { try { localStorage.setItem("moleculab." + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem("moleculab." + k); } catch (e) {} }
};

let DATA = null;                       // analyse courante
let CORR = LS.get("corrections", []);  // corrections validées
let BUSY = false;

/* ---------------------------------------------------------------- thème */
function applyTheme(t) {
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
applyTheme(LS.get("theme", "system"));
$("#theme").addEventListener("click", () => {
  const order = ["system", "light", "dark"];
  const next = order[(order.indexOf(LS.get("theme", "system")) + 1) % 3];
  LS.set("theme", next); applyTheme(next);
  $("#theme").title = "Thème : " + ({ system: "système", light: "clair", dark: "sombre" }[next]);
});

/* ---------------------------------------------------------------- onglets */
const VIEWS = ["analyse", "corrections", "methode", "reglages"];
function show(v) {
  if (!VIEWS.includes(v)) v = "analyse";
  VIEWS.forEach(n => { $("#v-" + n).hidden = (n !== v); });
  $$("nav button[data-view]").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === v)));
  if (location.hash.slice(1) !== v) { try { history.replaceState(null, "", "#" + v); } catch (e) {} }
}
$$("nav button[data-view]").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
show(location.hash.slice(1) || "analyse");

/* ---------------------------------------------------------------- réglages */
$("#apikey").value = LS.get("apikey", "");
$("#model").value = LS.get("model", "claude-sonnet-5-5");
$("#savekey").addEventListener("click", () => {
  LS.set("apikey", $("#apikey").value.trim());
  LS.set("model", $("#model").value);
  const k = $("#savedok"); k.hidden = false; setTimeout(() => k.hidden = true, 1800);
});
$("#clearkey").addEventListener("click", () => { LS.del("apikey"); $("#apikey").value = ""; });

/* ---------------------------------------------------------------- liens vers les moteurs */
const TOOLS = [
  { n: "ADMETlab 3.0",       d: "ADME et alertes",                 u: () => "https://admetlab3.scbdd.com/server/evaluation" },
  { n: "BioTransformer 3.0", d: "métabolites, enzymes",            u: () => "https://biotransformer.ca/" },
  { n: "GLORYx",             d: "métabolites, score de priorité",  u: () => "https://nerdd.univie.ac.at/gloryx" },
  { n: "ProTox 3.0",         d: "toxicité d'organe, toxicophores", u: () => "https://tox.charite.de/protox3/" },
  { n: "PubMed",             d: "valeurs humaines publiées",       u: s => "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent((s || "") + " pharmacokinetics") },
  { n: "PubChem",            d: "identité, descripteurs",          u: s => "https://pubchem.ncbi.nlm.nih.gov/#query=" + encodeURIComponent(s || "") },
  { n: "BDPM",               d: "RCP français",                    u: () => "https://base-donnees-publique.medicaments.gouv.fr/" }
];
function renderTools(q) {
  $("#tools").innerHTML = TOOLS.map(t =>
    `<a class="tool" href="${esc(t.u(q))}" target="_blank" rel="noopener"><strong>${esc(t.n)}</strong><span>${esc(t.d)}</span></a>`
  ).join("");
}

/* ---------------------------------------------------------------- cheminement */
function step(k, st) { const li = $(`#pipe li[data-step="${k}"]`); if (li) li.dataset.state = st; }
function resetPipe() { $$("#pipe li").forEach(li => li.removeAttribute("data-state")); }

/* ---------------------------------------------------------------- prompts */
const REGLES = `RÈGLES
- Tout en français : libellés, valeurs, commentaires. Seuls les identifiants normalisés restent en anglais (essais Tox21 comme NR-AR-LBD, numéros CAS, noms de gènes), suivis de leur libellé français entre parenthèses.
- Chaque assertion porte sa source nommée. Sans source, écris "estimation structurale".
- "niveau" : "A" valeur humaine mesurée (RCP, base publique des médicaments, monographie), "B" publication scientifique (PubMed), "C" prédiction in silico ou calcul structural.
- "confiance" de 0 à 1, sévère : 0,9 pour un RCP, 0,4 à 0,6 pour une prédiction structurale.
- Si deux sources crédibles divergent, donne DEUX assertions et mets "divergence": true sur chacune.
- N'invente aucun chiffre : un paramètre sans donnée reçoit assertions: [].
- Réponds UNIQUEMENT par le JSON demandé, sans texte autour ni bloc de code.`;

function P1(dci, smi, corr) {
  return `Tu es un moteur d'analyse pharmacologique pour un étudiant en pharmacie.
Molécule : DCI = ${dci || "(non fournie)"} ; SMILES = ${smi || "(non fourni)"}

Étape 1 sur 3 : identité et chimie, dans l'esprit d'ADMETlab 3.0 et de PubChem.

${REGLES}

Renvoie exactement :
{"identite":{"dci":"","synonymes":[""],"smiles_canonique":"","formule":"","masse_molaire":"","classe":"","indication":""},
 "chimie":[{"parametre":"","assertions":[{"valeur":"","source":"","niveau":"C","confiance":0.0,"nature":"calcul","commentaire":"","divergence":false}]}]}

"chimie" couvre, dans cet ordre : Formule brute et masse molaire ; Fonctions chimiques ; pKa ; Lipophilie (logP, logD 7,4) ; Solubilité aqueuse ; Surface polaire et liaisons hydrogène. "Fonctions chimiques" liste les groupes réellement présents dans la structure.${corr}`;
}

function P2(dci, smi, corr) {
  return `Tu es un moteur d'analyse pharmacologique.
Molécule : DCI = ${dci || "(non fournie)"} ; SMILES = ${smi || "(non fourni)"}

Étape 2 sur 3 : métabolisation, puis toxicité. Pars de la structure pour déduire les métabolites, dans l'esprit de BioTransformer 3.0 et de GLORYx. Cherche ensuite la toxicité de la molécule mère ET de chaque métabolite majeur, à partir des éléments structuraux porteurs de risque, dans l'esprit de ProTox 3.0.

${REGLES}

Renvoie exactement :
{"metabolisme":{"resume":"",
  "metabolites":[{"nom":"","smiles":"","reaction":"","enzyme":"","phase":1,"score":0.0,"actif":"actif|inactif|inconnu","interet_toxicologique":"","sources":[""]}],
  "assertions":[{"parametre":"","valeur":"","source":"","niveau":"C","confiance":0.0,"nature":"prediction","commentaire":""}]},
 "toxicologie":{"resume":"",
  "alertes_structurales":[{"fragment":"","risque":"","gravite":"haute|moyenne|faible","porteur":"molécule mère ou nom du métabolite","liste":"ProTox 3.0|Brenk|PAINS|estimation structurale"}],
  "organes":[{"cible":"","niveau":"élevé|modéré|faible","probabilite":0.0,"source":"","commentaire":""}],
  "assertions":[{"parametre":"","valeur":"","source":"","niveau":"C","confiance":0.0,"nature":"","commentaire":""}]}}

Huit métabolites au maximum, les plus importants, phase 1 et phase 2, avec l'enzyme et un score de priorité de 0 à 1. Signale explicitement un métabolite actif ou réactif.
"toxicologie.assertions" couvre la toxicité aiguë, hépatique, cardiaque, rénale, neurologique, la génotoxicité, la cancérogénicité et la reprotoxicité.${corr}`;
}

function P3(dci, smi, corr, dose) {
  const bloc = dose
    ? `\n\nDOSE FOURNIE : ${dose}. Calcule alors Cmax, AUC et Css en VALEURS ABSOLUES à partir de cette dose (AUC = F·D/CL ; Css,moy = F·D/(CL·τ)), pose le calcul dans "commentaire", et donne aussi la valeur normalisée par la dose entre parenthèses.`
    : `\n\nAUCUNE dose n'est fournie : Cmax, AUC et Css doivent être NORMALISÉES par la dose (unités en L⁻¹, h·L⁻¹), jamais en valeur absolue, puisque AUC = F·D/CL. Explique la normalisation dans "commentaire".`;
  return `Tu es un moteur d'analyse pharmacologique.
Molécule : DCI = ${dci || "(non fournie)"} ; SMILES = ${smi || "(non fourni)"}

Étape 3 sur 3 : pharmacocinétique, en privilégiant les valeurs humaines publiées (PubMed, RCP) sur les prédictions. Tmax ne dépend que de ka et ke, donc donne-le normalement.${bloc}

${REGLES}

Renvoie exactement :
{"pharmacocinetique":[{"parametre":"","assertions":[{"valeur":"","source":"","niveau":"A","confiance":0.0,"nature":"mesure","commentaire":"","divergence":false}]}],
 "hypotheses":[""],
 "lacunes":[""]}

"pharmacocinetique" couvre exactement ces paramètres, dans cet ordre : Biodisponibilité (F) ; Clairance (CL) ; Volume de distribution (Vd) ; Demi-vie (t½) ; Cmax ; Tmax ; AUC ; Concentration à l'état d'équilibre (Css) ; Liaison aux protéines plasmatiques ; Fraction libre (fu) ; CYP450 (phase I) ; Conjugaison (phase II) ; Transporteurs.
"hypotheses" : les hypothèses de calcul employées (70 kg, voie orale sauf indication contraire, cinétique linéaire, débit sanguin hépatique 90 L/h, modèle du foie bien agité).
"lacunes" : ce qui manque réellement, et quelle donnée le comblerait.${corr}`;
}

function corrBlock(list) {
  if (!list.length) return "";
  return "\n\nCORRECTIONS VALIDÉES PAR L'UTILISATEUR — elles priment sur toute prédiction. Reprends-les telles quelles, avec nature \"correction\", niveau \"A\" et la source indiquée :\n"
    + list.map(c => `- ${c.rubrique} / ${c.parametre} = ${c.valeur} (source : ${c.source}${c.note ? " — " + c.note : ""})`).join("\n");
}

/* ---------------------------------------------------------------- appel du moteur */
async function ask(prompt) {
  const key = (LS.get("apikey", "") || "").trim();
  if (!key) { const e = new Error("no_key"); e.code = "no_key"; throw e; }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: LS.get("model", "claude-sonnet-5-5"),
      max_tokens: 8192,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" }   // force une réponse JSON
      ]
    })
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch (e) {}
    const err = new Error(detail || ("HTTP " + res.status));
    err.code = res.status === 401 ? "bad_key" : res.status === 429 ? "rate_limited" : "http";
    throw err;
  }
  const json = await res.json();
  return parseJSON("{" + (json.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
}

function parseJSON(text) {
  let t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  const err = new Error("réponse illisible"); err.code = "parse"; throw err;
}

/* ---------------------------------------------------------------- rendu */
function confBar(c) {
  const p = Math.max(0, Math.min(1, Number(c) || 0));
  return `<span class="conf" title="indice de confiance"><i><b style="width:${(p * 100).toFixed(0)}%"></b></i><span>${(p * 100).toFixed(0)} %</span></span>`;
}

function asrtHTML(a) {
  const lvl = ["A", "B", "C"].includes(a.niveau) ? a.niveau : "C";
  return `<div class="asrt">
    <span class="val">${esc(a.valeur)}</span>
    <span class="chip ${lvl}" title="niveau de preuve">${lvl}</span>
    <span class="src">${esc(a.source || "estimation structurale")}</span>
    ${a.confiance != null ? confBar(a.confiance) : ""}
    ${a.divergence ? '<span class="flag">divergence</span>' : ""}
    ${a.nature === "correction" ? '<span class="flag good">corrigé</span>' : ""}
    ${a.commentaire ? `<span class="note">${esc(a.commentaire)}</span>` : ""}
  </div>`;
}

function paramTable(rows, rubrique) {
  if (!rows || !rows.length) return '<p class="hint">Aucun paramètre renvoyé.</p>';
  return `<div class="scroll"><table class="par">
    <thead><tr><th>Paramètre</th><th>Valeurs et sources</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td class="pname">${esc(r.parametre)}</td>
      <td>${(r.assertions && r.assertions.length) ? r.assertions.map(asrtHTML).join("")
        : '<span class="hint">Pas de donnée fiable. Voir les lacunes.</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="fix" data-rub="${esc(rubrique)}" data-par="${esc(r.parametre)}">corriger</button></td>
    </tr>`).join("")}
    </tbody></table></div>`;
}

const PENDING = '<div class="pending"><em></em><span>en cours…</span></div>';

function render(d) {
  const id = d.identite || {}, met = d.metabolisme, tox = d.toxicologie;
  const hyp = (d.hypotheses || []).length
    ? `<details class="m"><summary>Hypothèses de calcul (${d.hypotheses.length})</summary><ul class="tight">${d.hypotheses.map(h => `<li>${esc(h)}</li>`).join("")}</ul></details>` : "";
  const lac = (d.lacunes || []).length
    ? `<details class="m"><summary>Données manquantes (${d.lacunes.length})</summary><ul class="tight">${d.lacunes.map(h => `<li>${esc(h)}</li>`).join("")}</ul></details>` : "";

  $("#out").innerHTML = `
  <div class="card">
    <div class="head"><h2>${esc(id.dci || "Molécule")}</h2><span class="hint">${esc(id.classe || "")}</span></div>
    <div class="body">
      ${id.indication ? `<p style="margin:0 0 12px;font-size:14px;color:var(--ink-2)">${esc(id.indication)}</p>` : ""}
      <div class="meta-grid">
        <div><div class="k">SMILES canonique</div><div class="v">${esc(id.smiles_canonique || "—")}</div></div>
        <div><div class="k">Formule</div><div class="v">${esc(id.formule || "—")}</div></div>
        <div><div class="k">Masse molaire</div><div class="v">${esc(id.masse_molaire || "—")}</div></div>
        ${d.dose ? `<div><div class="k">Dose saisie</div><div class="v" style="font-family:var(--font-body);word-break:normal">${esc(d.dose)}</div></div>`
                 : `<div><div class="k">Synonymes</div><div class="v" style="font-family:var(--font-body);word-break:normal">${esc((id.synonymes || []).join(", ") || "—")}</div></div>`}
      </div>
    </div>
  </div>

  <div class="card rub">
    <div class="head"><h2>Chimie</h2></div>
    <div class="body">${d.chimie ? paramTable(d.chimie, "Chimie") : PENDING}</div>
  </div>

  <div class="card rub">
    <div class="head"><h2>Métabolisation</h2>${met ? `<span class="hint">${(met.metabolites || []).length} métabolite(s)</span>` : ""}</div>
    <div class="body">${!met ? PENDING : `
      ${met.resume ? `<p style="margin:0 0 12px;font-size:14px">${esc(met.resume)}</p>` : ""}
      <div class="mets">${(met.metabolites || []).map(m => `
        <div class="met">
          <div class="top">
            <span class="nm">${esc(m.nom)}</span>
            <span class="ph">Phase ${esc(m.phase || "?")}</span>
            <span class="rx">${esc(m.reaction || "")}${m.enzyme ? " · " + esc(m.enzyme) : ""}</span>
            ${m.score != null ? confBar(m.score) : ""}
            ${m.actif && m.actif !== "inconnu" ? `<span class="chip ${m.actif === "actif" ? "B" : "C"}">${esc(m.actif)}</span>` : ""}
            ${(m.sources || []).map(s => `<span class="src">${esc(s)}</span>`).join("")}
          </div>
          ${m.smiles ? `<div class="sm">${esc(m.smiles)}</div>` : ""}
          ${m.interet_toxicologique ? `<div class="note" style="margin-top:5px">${esc(m.interet_toxicologique)}</div>` : ""}
        </div>`).join("") || '<p class="hint">Aucun métabolite renvoyé.</p>'}
      </div>
      ${(met.assertions || []).length ? `<div style="margin-top:14px">${paramTable(met.assertions.map(a => ({ parametre: a.parametre, assertions: [a] })), "Métabolisation")}</div>` : ""}`}
    </div>
  </div>

  <div class="card rub">
    <div class="head"><h2>Toxicologie</h2></div>
    <div class="body">${!tox ? PENDING : `
      ${tox.resume ? `<p style="margin:0 0 12px;font-size:14px">${esc(tox.resume)}</p>` : ""}
      ${(tox.alertes_structurales || []).length ? `
        <div class="eyebrow" style="margin-bottom:7px">Alertes structurales</div>
        <div class="alerts">${tox.alertes_structurales.map(a => `
          <div class="alert ${a.gravite === "haute" ? "h" : a.gravite === "moyenne" ? "m" : "l"}">
            <div class="frag">${esc(a.fragment || "?")}</div>
            <div><div>${esc(a.risque || "")}</div>
            <div class="note">Porté par ${esc(a.porteur || "la molécule mère")} · liste : ${esc(a.liste || "estimation structurale")}</div></div>
          </div>`).join("")}</div>` : ""}
      ${(tox.organes || []).length ? `
        <div class="eyebrow" style="margin:16px 0 7px">Cibles d'organe</div>
        <div class="scroll"><table class="par"><tbody>${tox.organes.map(o => `<tr>
          <td class="pname">${esc(o.cible)}</td>
          <td><div class="asrt"><span class="val">${esc(o.niveau || "")}</span>
          ${o.probabilite != null ? confBar(o.probabilite) : ""}
          <span class="src">${esc(o.source || "estimation structurale")}</span>
          ${o.commentaire ? `<span class="note">${esc(o.commentaire)}</span>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : ""}
      ${(tox.assertions || []).length ? `<div style="margin-top:16px"><div class="eyebrow" style="margin-bottom:7px">Toxicité générale</div>${paramTable(tox.assertions.map(a => ({ parametre: a.parametre, assertions: [a] })), "Toxicologie")}</div>` : ""}`}
    </div>
  </div>

  <div class="card rub">
    <div class="head"><h2>Pharmacocinétique</h2></div>
    <div class="body">
      ${d.dose
        ? `<div class="warnbox" style="margin-bottom:12px">Dose prise en compte : <strong>${esc(d.dose)}</strong>. Cmax, AUC et Css sont calculés en valeurs absolues, avec le calcul posé sous chaque ligne.</div>`
        : `<div class="warnbox" style="margin-bottom:12px">Aucune dose n'est saisie. Cmax, AUC et Css sont donc donnés <strong>normalisés par la dose</strong> : AUC = F·D/CL, donc sans D la valeur absolue n'existe pas. Tmax, qui ne dépend que de ka et ke, reste calculable.</div>`}
      ${d.pharmacocinetique ? paramTable(d.pharmacocinetique, "Pharmacocinétique") : PENDING}
    </div>
  </div>

  ${hyp}${lac}
  <p class="hint">Outil pédagogique. Une ligne de niveau C est une prédiction, pas une donnée clinique.</p>`;

  // Le schéma de l'UEL place la toxicité en dernier, après la pharmacocinétique : on suit cet ordre.
  const cards = $$("#out .card");
  const cTox = cards.find(c => c.querySelector("h2")?.textContent === "Toxicologie");
  const cPk = cards.find(c => c.querySelector("h2")?.textContent === "Pharmacocinétique");
  if (cTox && cPk && cTox.parentNode) cTox.parentNode.insertBefore(cPk, cTox);

  $$("#out .fix").forEach(b => b.addEventListener("click", () => openFix(b.dataset.rub, b.dataset.par)));
}

function fail(msg) {
  $("#out").insertAdjacentHTML("afterbegin",
    `<div class="card"><div class="body"><div class="critbox">${esc(msg)}</div></div></div>`);
}

/* ---------------------------------------------------------------- analyse en trois temps */
async function analyse(dci, smi, dose) {
  if (BUSY) return;
  BUSY = true; $("#go").disabled = true; $("#go").textContent = "Analyse en cours…";
  $("#pipecard").hidden = false; $("#toolscard").hidden = false;
  resetPipe(); renderTools(smi || dci);
  DATA = { identite: { dci: dci || smi }, dose: dose || "" };
  render(DATA);

  const corr = corrBlock(CORR.filter(c => c.molecule === slug(dci || smi)));
  const phases = [
    { k: "id",  p: () => P1(dci, smi, corr) },
    { k: "met", p: () => P2(dci, smi, corr) },
    { k: "pk",  p: () => P3(dci, smi, corr, dose) }
  ];

  try {
    for (const ph of phases) {
      step(ph.k, "run");
      if (ph.k === "met") step("tox", "run");
      try {
        const part = await ask(ph.p());
        Object.assign(DATA, part);
        if (DATA.identite && !DATA.identite.dci) DATA.identite.dci = dci || smi;
        render(DATA);
        step(ph.k, "done");
        if (ph.k === "met") step("tox", "done");
      } catch (e) {
        step(ph.k, "fail");
        if (ph.k === "met") step("tox", "fail");
        const msg = {
          no_key: "Aucune clé d'API enregistrée. Ouvre l'onglet Réglages et colle ta clé Anthropic.",
          bad_key: "La clé d'API est refusée. Vérifie-la dans l'onglet Réglages.",
          rate_limited: "Trop de requêtes d'affilée. Attends une minute, puis relance.",
          parse: "Le moteur a répondu dans un format illisible sur cette étape."
        }[e && e.code] || ("Cette étape n'a pas abouti" + (e && e.message ? " : " + e.message : "") + ".");
        fail(msg);
        if (e && (e.code === "no_key" || e.code === "bad_key" || e.code === "rate_limited")) break;
      }
    }
  } finally {
    BUSY = false; $("#go").disabled = false; $("#go").textContent = "Analyser la molécule";
  }
}

$("#f").addEventListener("submit", e => {
  e.preventDefault();
  const dci = $("#dci").value.trim(), smi = $("#smiles").value.trim();
  if (!dci && !smi) { $("#dci").focus(); return; }
  const d = $("#dose").value.trim();
  const dose = d ? [d, $("#voie").value || "voie orale", $("#tau").value.trim()].filter(Boolean).join(", ") : "";
  analyse(dci, smi, dose);
});
$$(".examples button").forEach(b => b.addEventListener("click", () => {
  $("#dci").value = b.dataset.ex; $("#smiles").value = "";
  $("#f").requestSubmit();
}));
$("#copysmi").addEventListener("click", async () => {
  const t = ($("#smiles").value || DATA?.identite?.smiles_canonique || "").trim();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
    const k = $("#copyok"); k.hidden = false; setTimeout(() => k.hidden = true, 1600);
  } catch (e) { $("#smiles").value = t; $("#smiles").select(); }
});

/* ---------------------------------------------------------------- import d'un résultat d'outil */
$("#impgo").addEventListener("click", async () => {
  const raw = $("#impdata").value.trim(), src = $("#impsrc").value;
  $("#imperr").innerHTML = "";
  if (!raw) return;
  if (!DATA || !DATA.chimie) { $("#imperr").innerHTML = '<div class="warnbox" style="margin-top:8px">Lance d\'abord une analyse : l\'import vient s\'y greffer.</div>'; return; }
  const btn = $("#impgo"); btn.disabled = true; btn.textContent = "Fusion…";
  try {
    const merged = await ask(`Voici une analyse existante au format JSON, et un résultat brut copié depuis ${src}.
Fusionne le résultat brut dans le JSON SANS rien supprimer : pour chaque paramètre concerné, AJOUTE une assertion avec "source":"${src}", le bon "niveau", et "divergence": true sur les deux assertions si la valeur diffère de celle déjà présente. Dédoublonne les métabolites par structure et non par nom : un métabolite déjà présent reçoit "${src}" dans son tableau "sources" au lieu d'une nouvelle entrée. Réponds uniquement par le JSON complet, au même schéma, en français.

JSON actuel :
${JSON.stringify(DATA)}

Résultat brut de ${src} :
${raw}`);
    DATA = merged; render(merged); $("#impdata").value = "";
  } catch (e) {
    $("#imperr").innerHTML = '<div class="warnbox" style="margin-top:8px">La fusion n\'a pas abouti. Réessaie avec un extrait plus court.</div>';
  } finally {
    btn.disabled = false; btn.textContent = "Fusionner dans les fiches";
  }
});

/* ---------------------------------------------------------------- corrections */
let FIX = { rub: "", par: "" };
function openFix(rub, par) {
  FIX = { rub, par };
  $("#dlgwhat").textContent = `${rub} · ${par} — pour ${DATA?.identite?.dci || "cette molécule"}.`;
  $("#cval").value = ""; $("#csrc").value = ""; $("#cnote").value = "";
  $("#dlg").showModal();
}
$("#dlgcancel").addEventListener("click", () => $("#dlg").close());
$("#dlgf").addEventListener("submit", e => {
  e.preventDefault();
  const nom = DATA?.identite?.dci || $("#dci").value || $("#smiles").value;
  const rec = {
    molecule: slug(nom), molecule_nom: nom,
    rubrique: FIX.rub, parametre: FIX.par,
    valeur: $("#cval").value.trim(), source: $("#csrc").value.trim(),
    note: $("#cnote").value.trim(), date: new Date().toISOString()
  };
  if (!rec.valeur || !rec.source) return;
  CORR = CORR.filter(c => !(c.molecule === rec.molecule && c.rubrique === rec.rubrique && c.parametre === rec.parametre));
  CORR.push(rec);
  LS.set("corrections", CORR);
  renderCorr();
  $("#dlg").close();
});

function renderCorr() {
  const el = $("#corrlist");
  if (!CORR.length) { el.innerHTML = '<p class="hint">Aucune correction pour l\'instant.</p>'; return; }
  const sorted = CORR.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  el.innerHTML = sorted.map((c, idx) => `
    <div class="corr-item">
      <h3>${esc(c.molecule_nom || c.molecule)} · ${esc(c.parametre)}</h3>
      <div class="d">${esc(c.rubrique)} — ${esc(new Date(c.date).toLocaleDateString("fr-FR"))}</div>
      <div class="asrt" style="margin-top:6px">
        <span class="val">${esc(c.valeur)}</span><span class="chip A">A</span><span class="src">${esc(c.source)}</span>
        <button class="fix" data-del="${idx}" style="margin-left:auto">supprimer</button>
      </div>
      ${c.note ? `<div class="note">${esc(c.note)}</div>` : ""}
    </div>`).join("");
  $$("#corrlist [data-del]").forEach(b => b.addEventListener("click", () => {
    const target = sorted[Number(b.dataset.del)];
    CORR = CORR.filter(c => c !== target);
    LS.set("corrections", CORR); renderCorr();
  }));
}
renderCorr();

$("#corrExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(CORR, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "moleculab-corrections.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("#corrImportBtn").addEventListener("click", () => $("#corrImport").click());
$("#corrImport").addEventListener("change", async e => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const arr = JSON.parse(await file.text());
    if (!Array.isArray(arr)) throw new Error();
    const key = c => c.molecule + "|" + c.rubrique + "|" + c.parametre;
    const map = new Map(CORR.map(c => [key(c), c]));
    arr.forEach(c => { if (c && c.molecule && c.parametre) map.set(key(c), c); });
    CORR = [...map.values()];
    LS.set("corrections", CORR); renderCorr();
  } catch (err) {
    alert("Fichier illisible : attendu un export JSON de MolécuLab.");
  }
  e.target.value = "";
});
