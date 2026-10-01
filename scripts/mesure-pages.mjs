// Mission #134 — mesure du parcours réel, en conditions mobile 4G lente.
//
// Chrome piloté par CDP : émulation mobile, réseau bridé, processeur bridé ×4,
// cache et cookies vidés avant CHAQUE page. Aucune modification du site : on
// regarde la production telle qu'elle est servie.
//
// Mission #135 — ET IL S'ANNONCE.
//
// Les relevés de #134 et #137 ont été comptés comme de vraies visites : le
// navigateur remplaçait son User-Agent par celui d'un téléphone, et rien ne
// disait qu'il s'agissait d'une mesure. Le jeton est donc collé à l'agent
// émulé, et le serveur écrit la ligne comme interne (lib/telemetry/tagged.ts).
//
// RÈGLE PERMANENTE : aucune mesure en production sans ce jeton.
//
// Usage :
//   node scripts/mesure-pages.mjs /            une page, un navigateur neuf
//   BASE=http://localhost:3001 node scripts/mesure-pages.mjs /tarifs
//   SORTIE=avant.json node scripts/mesure-pages.mjs /analyse
//
// Les relevés et le profil Chrome vont dans .cache/mesure/ (hors dépôt).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Mission #135 — UNE SEULE SOURCE pour le jeton. On le lit dans le module du
// produit plutôt que de le recopier : tests/mesure-interne.test.ts refuse que
// les deux divergent, et une copie finirait par mentir.
const MEASURE_AGENT_TOKEN = /MEASURE_AGENT_TOKEN = "([^"]+)"/.exec(
  fs.readFileSync(path.join(process.cwd(), "lib/telemetry/internal.ts"), "utf8"),
)?.[1];
if (!MEASURE_AGENT_TOKEN) throw new Error("jeton de mesure introuvable dans lib/telemetry/internal.ts");

const CHROME = path.join(
  process.env.LOCALAPPDATA,
  "ms-playwright",
  "chromium-1228",
  "chrome-win64",
  "chrome.exe",
);
// Profil et port uniques par exécution : une instance restée en vie servait
// sinon une liste d'onglets périmée, et les commandes partaient dans le vide.
const SORTIE_DIR = path.join(process.cwd(), ".cache", "mesure");
const PROFIL = path.join(SORTIE_DIR, `profil-${process.pid}`);
const PORT = 9400 + (process.pid % 150);

const BASE = process.env.BASE || "https://www.negoscore.fr";
const PAGES = [
  { nom: "/", url: BASE + "/" },
  { nom: "/analyse", url: BASE + "/analyse" },
  { nom: "/exemple", url: BASE + "/exemple" },
  { nom: "/tarifs", url: BASE + "/tarifs" },
  { nom: "/admin", url: BASE + "/admin" },
];

const RESEAU = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
// L'agent émulé est celui d'un téléphone — c'est la condition qu'on veut
// mesurer — SUIVI du jeton de mesure, qui dit ce que ce navigateur est.
const UA_MOBILE =
  `Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 ${MEASURE_AGENT_TOKEN}`;

const SONDE = `
window.__m = { fcp: 0, lcp: 0, cls: 0, shifts: [], longtasks: [], events: [] };
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__m.fcp = e.startTime; })
    .observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { const es = l.getEntries(); const d = es[es.length - 1]; if (d) window.__m.lcp = d.startTime; })
    .observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) {
      window.__m.cls += e.value;
      window.__m.shifts.push({ v: Math.round(e.value * 10000) / 10000, t: Math.round(e.startTime),
        src: (e.sources || []).map((s) => s.node ? (s.node.nodeName + (s.node.className && typeof s.node.className === "string" ? "." + s.node.className.split(" ")[0] : "")) : "?") });
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.longtasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); })
    .observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.events.push({ n: e.name, d: Math.round(e.duration), t: Math.round(e.startTime) }); })
    .observe({ type: "event", durationThreshold: 16, buffered: true });
} catch (e) { window.__m.erreur = String(e); }
`;

const RELEVE = `
(() => {
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const res = performance.getEntriesByType("resource").map((r) => ({
    url: r.name, type: r.initiatorType, debut: Math.round(r.startTime), fin: Math.round(r.responseEnd),
    transfere: r.transferSize, decode: r.decodedBodySize, protocole: r.nextHopProtocol,
  }));
  const fcp = window.__m.fcp;
  const tbt = window.__m.longtasks.filter((t) => t.s + t.d > fcp).reduce((s, t) => s + Math.max(0, t.d - 50), 0);
  return {
    ttfb: Math.round(nav.responseStart || 0),
    doc_octets: nav.transferSize || 0,
    dom_interactif: Math.round(nav.domInteractive || 0),
    charge: Math.round(nav.loadEventEnd || 0),
    fcp: Math.round(fcp), lcp: Math.round(window.__m.lcp),
    cls: Math.round(window.__m.cls * 10000) / 10000,
    shifts: window.__m.shifts,
    longtasks: window.__m.longtasks,
    tbt: Math.round(tbt),
    events: window.__m.events,
    res,
    titre: document.title,
    police_bloquante: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href),
    images_sans_dimensions: [...document.images]
      .filter((i) => !(i.getAttribute("width") && i.getAttribute("height")) && !i.style.aspectRatio)
      .map((i) => (i.currentSrc || i.src).slice(-70)),
  };
})()
`;

// ─── Client CDP minimal ────────────────────────────────────────────────────
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const attente = new Map();
  const ecoutes = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && attente.has(msg.id)) {
      const { ok, ko } = attente.get(msg.id);
      attente.delete(msg.id);
      if (msg.error) ko(new Error(JSON.stringify(msg.error)));
      else ok(msg.result);
    } else if (msg.method) {
      for (const f of ecoutes) f(msg);
    }
  });
  const pret = new Promise((ok, ko) => {
    ws.addEventListener("open", ok);
    ws.addEventListener("error", (e) => ko(new Error("websocket: " + e.message)));
  });
  return {
    pret,
    envoyer(method, params = {}, sessionId) {
      const n = ++id;
      return new Promise((ok, ko) => {
        const minuteur = setTimeout(() => { attente.delete(n); ko(new Error("delai depasse: " + method)); }, 30000);
        attente.set(n, { ok: (r) => { clearTimeout(minuteur); ok(r); }, ko: (e) => { clearTimeout(minuteur); ko(e); } });
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      });
    },
    sur(f) { ecoutes.push(f); },
    fermer() { ws.close(); },
  };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SORTIE_DIR, { recursive: true });
  fs.rmSync(PROFIL, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFIL}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-crash-reporter",
    "--disable-breakpad",
    "--hide-scrollbars",
    // Chrome 111+ refuse la connexion CDP d'un client qui envoie un en-tête
    // Origin : sans ce drapeau, les commandes de l'onglet restent sans réponse.
    "--remote-allow-origins=*",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
  ], { stdio: "ignore" });
  const fermer = () => { try { chrome.kill(); } catch {} try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch {} };
  process.on("exit", fermer);
  process.on("uncaughtException", (e) => { console.error("ECHEC:", e.message); fermer(); process.exit(1); });

  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    await dormir(250);
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { /* pas encore prêt */ }
  }
  if (!version) throw new Error("Chrome n'a pas démarré");

  const c = cdp(version.webSocketDebuggerUrl);
  await c.pret;

  // Un seul onglet, celui que Chrome ouvre au démarrage : les onglets créés
  // par Target.createTarget ne répondaient pas aux commandes. Le cache et les
  // cookies sont vidés AVANT chaque page, donc chacune reste une première
  // visite.
  const liste = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const cible = liste.find((t) => t.type === "page");
  const o = cdp(cible.webSocketDebuggerUrl);
  await o.pret;
  const env = (m, p) => o.envoyer(m, p);

  let courant = { requetes: [], redirections: [] };
  o.sur((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      courant.requetes.push({ url: msg.params.request.url, type: msg.params.type });
      if (msg.params.redirectResponse) {
        courant.redirections.push({ de: msg.params.redirectResponse.url, statut: msg.params.redirectResponse.status, vers: msg.params.request.url });
      }
    }
    if (msg.method === "Network.responseReceived" && msg.params.type === "Document") {
      courant.document = { url: msg.params.response.url, statut: msg.params.response.status, entetes: msg.params.response.headers };
    }
  });

  await env("Network.enable");
  await env("Page.enable");
  await env("Runtime.enable");
  await env("Emulation.setDeviceMetricsOverride", { width: 412, height: 823, deviceScaleFactor: 2.625, mobile: true });
  await env("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await env("Emulation.setUserAgentOverride", { userAgent: UA_MOBILE, platform: "Android", userAgentMetadata: { mobile: true, platform: "Android", platformVersion: "11", architecture: "", model: "moto g power (2022)", brands: [{ brand: "Chromium", version: "139" }], fullVersion: "139.0.0.0" } });
  await env("Page.addScriptToEvaluateOnNewDocument", { source: SONDE });

  const resultats = [];
  const voulues = process.argv.slice(2);
  for (const page of PAGES.filter((p) => voulues.length === 0 || voulues.includes(p.nom))) {
    process.stderr.write(`
[${page.nom}] `);
    courant = { requetes: [], redirections: [] };
    await env("Emulation.setCPUThrottlingRate", { rate: 1 });
    await env("Page.navigate", { url: "about:blank" });
    await dormir(300);
    await env("Network.clearBrowserCache");
    await env("Network.clearBrowserCookies");
    await env("Network.emulateNetworkConditions", RESEAU);
    if (process.env.BLOQUE) await env("Network.setBlockedURLs", { urls: process.env.BLOQUE.split(",") });
    await env("Emulation.setCPUThrottlingRate", { rate: 4 });
    process.stderr.write("navigate ");
    const t0 = Date.now();
    await env("Page.navigate", { url: page.url });
    process.stderr.write("attente ");
    await dormir(15000);
    const reponse = await env("Runtime.evaluate", { expression: RELEVE, returnByValue: true });
    if (reponse.exceptionDetails) process.stderr.write("EXCEPTION: " + JSON.stringify(reponse.exceptionDetails).slice(0, 300));
    const mesure = reponse.result && reponse.result.value ? reponse.result.value : { erreur: "releve vide", detail: reponse.exceptionDetails ? reponse.exceptionDetails.text : null };
    mesure.mur_ms = Date.now() - t0;
    mesure.redirections = courant.redirections;
    mesure.statut_document = courant.document?.statut ?? null;
    mesure.url_document = courant.document?.url ?? null;
    mesure.entete_document = courant.document?.entetes ?? null;
    resultats.push({ page: page.nom, url: page.url, mesure });
    fs.writeFileSync(path.join(SORTIE_DIR, process.env.SORTIE || "mesures.json"), JSON.stringify(resultats, null, 2));
    console.log(`${page.nom} : fcp=${mesure.fcp} lcp=${mesure.lcp} cls=${mesure.cls} tbt=${mesure.tbt} ttfb=${mesure.ttfb} req=${(mesure.res || []).length}`);
  }

  fs.writeFileSync(path.join(SORTIE_DIR, process.env.SORTIE || "mesures.json"), JSON.stringify(resultats, null, 2));
  o.fermer();
  c.fermer();
  chrome.kill();
  console.log("\necrit: mesures134.json");
}

main().catch((e) => { console.error("ECHEC:", e.message); process.exit(1); });
