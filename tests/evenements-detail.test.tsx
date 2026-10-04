import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_LABEL,
  agentFamily,
  clientIp,
  VISITOR_LENGTH,
  visitorFingerprint,
} from "@/lib/telemetry/visiteur";

// Mission #131 — VOIR LES ÉVÉNEMENTS UN PAR UN.
//
// Le cockpit ne montrait que des totaux. Trois questions du 01/10 ont coûté une
// heure chacune, et se répondent ici en dix secondes :
//   « ces 17 vues de guide, robot ou gens ? »      → la colonne Navigateur
//   « cette visite, Franceska ou pas ? »            → la colonne Appareil
//   « ce +1 sur dm_exemple, moi ou une créatrice ? » → la colonne Interne
//
// Ce fichier tient les deux promesses qui vont avec : l'empreinte distingue
// sans identifier, et rien de ce qui identifierait n'atteint l'écran.

const UA = {
  instagramIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.27.103 (iPhone14,3; iOS 17_5_1; fr_FR; fr; scale=3.00; 1284x2778; 600821839)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 Instagram 334.0.0.32.98 Android (33/13; 450dpi; 1080x2176; samsung; SM-S918B; dm3q; qcom; fr_FR; 600821839)",
  tiktokIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BytedanceWebview/d8a21c6 musical_ly_34.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 musical_ly_2023405030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/34.5.3",
  safariIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  mesure:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 NegoscoreMesure/1",
};

// ───────────────────────────────────────────────────────────────────────────
describe("la famille de navigateur, sur de vrais user-agents", () => {
  it.each([
    ["instagram", UA.instagramIOS],
    ["instagram", UA.instagramAndroid],
    ["tiktok", UA.tiktokIOS],
    ["tiktok", UA.tiktokAndroid],
    ["safari", UA.safariIOS],
    ["chrome", UA.chromeAndroid],
    ["chrome", UA.chromeDesktop],
    ["firefox", UA.firefox],
    ["edge", UA.edge],
    ["robot", UA.googlebot],
    ["mesure", UA.mesure],
  ])("%s", (attendue, agent) => {
    expect(agentFamily(agent)).toBe(attendue);
  });

  it("l'ordre compte : un navigateur intégré annonce aussi Safari ou Chrome", () => {
    // Instagram sur Android contient « Chrome/126 » ; TikTok sur iOS contient
    // « Mobile/15E148 ». Si on cherchait Chrome en premier, les deux canaux
    // qu'on mesure disparaîtraient dans la masse.
    expect(UA.instagramAndroid).toContain("Chrome/");
    expect(agentFamily(UA.instagramAndroid)).toBe("instagram");
    expect(UA.tiktokAndroid).toContain("Chrome/");
    expect(agentFamily(UA.tiktokAndroid)).toBe("tiktok");
    // Et le navigateur de mesure annonce Chrome lui aussi.
    expect(UA.mesure).toContain("Chrome/");
    expect(agentFamily(UA.mesure)).toBe("mesure");
  });

  it("sans user-agent : inconnu, jamais une famille inventée", () => {
    expect(agentFamily(null)).toBe("inconnu");
    expect(agentFamily("")).toBe("inconnu");
    expect(agentFamily("quelque chose")).toBe("inconnu");
  });

  it("chaque famille a un libellé lisible", () => {
    for (const famille of Object.keys(AGENT_LABEL)) {
      expect(AGENT_LABEL[famille as keyof typeof AGENT_LABEL].length).toBeGreaterThan(2);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("l'empreinte du jour", () => {
  const SEL = "a".repeat(64);
  const AUTRE_SEL = "b".repeat(64);

  it("deux requêtes du même appareil le même jour portent la même empreinte", () => {
    const une = visitorFingerprint(SEL, "203.0.113.7", UA.chromeAndroid);
    const deux = visitorFingerprint(SEL, "203.0.113.7", UA.chromeAndroid);
    expect(une).toBe(deux);
    expect(une).toHaveLength(VISITOR_LENGTH);
    expect(une).toMatch(/^[0-9a-f]{6}$/);
  });

  it("un autre appareil, ou une autre adresse, donne une autre empreinte", () => {
    const reference = visitorFingerprint(SEL, "203.0.113.7", UA.chromeAndroid);
    expect(visitorFingerprint(SEL, "203.0.113.8", UA.chromeAndroid)).not.toBe(reference);
    expect(visitorFingerprint(SEL, "203.0.113.7", UA.safariIOS)).not.toBe(reference);
  });

  it("le lendemain, le sel a changé : les deux journées ne se relient pas", () => {
    const hier = visitorFingerprint(SEL, "203.0.113.7", UA.chromeAndroid);
    const aujourdhui = visitorFingerprint(AUTRE_SEL, "203.0.113.7", UA.chromeAndroid);
    expect(aujourdhui).not.toBe(hier);
  });

  it("sans sel, aucune empreinte : on ne hache jamais une adresse avec une valeur devinable", () => {
    expect(visitorFingerprint(null, "203.0.113.7", UA.chromeAndroid)).toBeNull();
    // Et sans rien à distinguer, rien non plus.
    expect(visitorFingerprint(SEL, null, null)).toBeNull();
  });

  it("l'adresse est lue dans les en-têtes, et seulement là", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("six caractères, pas davantage : il n'existe nulle part de hash complet", () => {
    expect(VISITOR_LENGTH).toBe(6);
    const source = readFileSync("lib/telemetry/visiteur.ts", "utf8");
    // Le hash est tronqué AVANT de sortir de la fonction : rien ne renvoie les
    // 64 caractères.
    expect(source).toContain(".slice(0, VISITOR_LENGTH)");
    expect(source).not.toMatch(/return .*digest\("hex"\);/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
const donnees = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], detail: true, missing: false }));
vi.mock("@/lib/admin/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/data")>()),
  loadRecentEvents: async () => (donnees.missing ? "missing" : { rows: donnees.rows, detail: donnees.detail }),
}));

const { default: AdminEvents } = await import("@/app/admin/evenements/page");
const { readFileSync } = await import("node:fs");

const LIGNE = {
  id: "11111111-1111-4111-8111-111111111111",
  occurred_at: "2026-10-01T18:46:23.000Z",
  event_name: "example_view",
  path: "/analyse/demo",
  utm_source: "instagram",
  utm_campaign: "lancement",
  utm_content: "dm_exemple",
  environment: "production",
  internal: false,
  visitor: "9f3a1c",
  internal_reason: null,
  agent_family: "instagram",
  // Mission #152 — cette ligne-ci vient du lien envoyé en DM : pas d'origine.
  entity_type: null,
  entity_id: null,
};

const rendre = async () => renderToStaticMarkup(await AdminEvents());
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/[\s ]+/g, " ");

beforeEach(() => {
  donnees.rows = [LIGNE];
  donnees.detail = true;
  donnees.missing = false;
});

describe("la vue des événements", () => {
  it("rend les huit colonnes attendues", async () => {
    const lu = texte(await rendre());
    for (const colonne of [
      "Date et heure",
      "Appareil",
      "Événement",
      "Page",
      "Source · campagne · contenu",
      "Origine du clic",
      "Interne",
      "Navigateur",
    ]) {
      expect(lu, colonne).toContain(colonne);
    }
  });

  it("une ligne dit l'heure à la seconde, l'empreinte, l'attribution et la famille", async () => {
    const lu = texte(await rendre());
    expect(lu).toMatch(/01\/10 \d{2}:46:23/);
    expect(lu).toContain("9f3a1c");
    expect(lu).toContain("example_view");
    expect(lu).toContain("/analyse/demo");
    expect(lu).toContain("instagram · lancement · dm_exemple");
    expect(lu).toContain("Navigateur intégré Instagram");
  });

  // Mission #152 — DM OU SITE, LA COLONNE LE DIT.
  //
  // Les deux chemins vers l'exemple chiffré se lisent sur la même ligne :
  // celui du DM porte une attribution et aucune origine, celui du site porte
  // une origine et aucune attribution — parce qu'un lien interne n'étiquette
  // jamais l'acquisition de quelqu'un qui est déjà là.
  // La vue rend ce qu'on lui donne ; encore faut-il que la requête aille le
  // chercher. Sans ces deux colonnes, la colonne « Origine du clic »
  // afficherait un tiret pour TOUT, y compris pour les vues venues du site,
  // et on conclurait que personne n'y va.
  it("la requête des événements demande bien les colonnes d'origine", () => {
    const source = readFileSync("lib/admin/data.ts", "utf8");
    const colonnes = /const EVENT_COLUMNS =\s*"?([^";]*)"/.exec(source.replace(/\n/g, " "))?.[1] ?? "";
    expect(colonnes.split(",").map((c) => c.trim())).toEqual(expect.arrayContaining(["entity_type", "entity_id"]));
  });

  it("un exemple vu depuis le site affiche d'où le clic est parti", async () => {
    donnees.rows = [
      { ...LIGNE, utm_source: null, utm_campaign: null, utm_content: null, entity_type: "origine", entity_id: "/" },
    ];
    const lu = texte(await rendre());
    expect(lu).toContain("depuis /");
    // Et surtout : aucune attribution inventée pour autant.
    expect(lu).toContain("non_attribue");
  });

  it("un exemple vu depuis le pied de page se distingue de l'accueil", async () => {
    donnees.rows = [{ ...LIGNE, entity_type: "origine", entity_id: "/pied-de-page" }];
    expect(texte(await rendre())).toContain("depuis /pied-de-page");
  });

  it("un exemple vu depuis un DM n'a pas d'origine, et garde son attribution", async () => {
    const lu = texte(await rendre());
    expect(lu).toContain("instagram · lancement · dm_exemple");
    // Un tiret, pas une origine inventée.
    expect(lu).toContain("—");
  });

  it("une visite sans attribution le dit, au lieu de laisser un blanc", async () => {
    donnees.rows = [{ ...LIGNE, utm_source: null, utm_campaign: null, utm_content: null }];
    expect(texte(await rendre())).toContain("non_attribue");
  });

  it("un événement interne APPARAÎT, marqué, avec la raison de son exclusion", async () => {
    donnees.rows = [
      { ...LIGNE, id: "a", internal: true, internal_reason: "mesure", agent_family: "mesure" },
      { ...LIGNE, id: "b", internal: true, internal_reason: "cookie" },
      { ...LIGNE, id: "c", internal: true, internal_reason: "compte" },
    ];
    const lu = texte(await rendre());
    // C'est le seul moyen de vérifier que le marquage de #118 et le jeton de
    // #135 font ce qu'on croit.
    expect(lu).toContain("jeton de mesure");
    expect(lu).toContain("cookie");
    expect(lu).toContain("compte");
  });

  it("une ligne de production non interne est dite « non »", async () => {
    expect(texte(await rendre())).toContain("non");
  });

  it("une ligne hors production dit son environnement", async () => {
    donnees.rows = [{ ...LIGNE, environment: "preview" }];
    expect(texte(await rendre())).toContain("preview");
  });

  it("la migration absente est annoncée, au lieu de tirets qu'on prendrait pour des trous", async () => {
    donnees.detail = false;
    donnees.rows = [{ ...LIGNE, visitor: undefined, internal_reason: undefined, agent_family: undefined }];
    expect(texte(await rendre())).toContain("20261002000036");
  });

  it("NI l'adresse IP, NI le user-agent brut, NI un hash complet n'atteignent l'écran", async () => {
    donnees.rows = [{ ...LIGNE, visitor: "9f3a1c" }];
    const html = await rendre();
    // L'empreinte affichée fait six caractères, et il n'y a pas de hash plus
    // long dans le balisage.
    expect(html).toContain("9f3a1c");
    expect(html).not.toMatch(/[0-9a-f]{32,}/);
    // Aucune adresse IP, sous aucune forme.
    expect(html).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    // Et aucun user-agent : ni « Mozilla », ni « AppleWebKit », ni un nom de
    // modèle d'appareil.
    for (const morceau of ["Mozilla", "AppleWebKit", "iPhone", "Android", "Build/"]) {
      expect(html, morceau).not.toContain(morceau);
    }
    // La page ne lit d'ailleurs aucune colonne qui les contiendrait.
    const source = readFileSync("app/admin/evenements/page.tsx", "utf8");
    expect(source).not.toContain("user_agent");
    expect(source).not.toContain("ip");
  });

  it("quatre vues d'une même personne se lisent d'un coup d'œil", async () => {
    // La question posée par la mission : « ces quatre vues, c'est une personne
    // ou quatre ? ». Une seule empreinte, donc une seule personne.
    donnees.rows = ["a", "b", "c", "d"].map((id) => ({ ...LIGNE, id, visitor: "9f3a1c" }));
    const html = await rendre();
    expect(html.split("9f3a1c")).toHaveLength(5);
  });
});
