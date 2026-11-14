import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEASURE_AGENT_TOKEN } from "@/lib/telemetry/internal";
import { classerVisite, ROBOT_LABEL, ROBOT_REASONS, signatureAgent } from "@/lib/analytics/robot-visite";
import { dashboardTiles, robotHint, robotNotice, VISIT_EVENTS, visitCount, type DashboardData } from "@/lib/admin/data";

// Mission #213 — CE QUI SÉPARE UN ROBOT D'UNE PERSONNE, ET CE QUE ÇA AFFICHE.
//
// LE CONSTAT (11→14/11, relevé dans /admin/evenements) : 5 à 8 landing_view
// par jour sur l'accueil, toutes « direct », sans référent, empreinte
// différente à chaque fois, User-Agent Chrome. Sur 26 pages vues : 0
// défilement, 0 geste, 0 contact avec le champ, et un page_engagement 2 à 4 s
// après le landing_view.
//
// Le filtre de la #120 ne pouvait pas les voir : il écarte « les robots qui
// DISENT qui ils sont », et ceux-là annoncent Chrome.
//
// LE CŒUR DE CE FICHIER est le premier bloc : la requête du constat, rejouée.

const UA_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_INSTAGRAM = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 Instagram 302.0.0.23.109 Android";
const UA_GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// Ce qu'un VRAI Chromium envoie sur une sous-requête. Mesuré le 14/11/2026,
// pas supposé : route jetable /dev/entetes, Chromium 156, quatre types de
// requêtes. Voir le commentaire de lib/analytics/robot-visite.ts.
const INDICES_REELS = {
  "sec-ch-ua": '"Not:A-Brand";v="8", "Chromium";v="156"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

const beacon = (extra: Record<string, string> = {}) =>
  new Headers({ "sec-fetch-dest": "empty", "sec-fetch-mode": "no-cors", "sec-fetch-site": "same-origin", ...extra });

describe("LA REQUÊTE DU CONSTAT, REJOUÉE", () => {
  it("un sendBeacon qui annonce Chrome SANS AUCUN indice client est classé robot", () => {
    const verdict = classerVisite(beacon({ "user-agent": UA_CHROME }));
    expect(verdict.robot).toBe(true);
    expect(verdict.reason).toBe("sans_indices");
  });

  it("LE MÊME User-Agent AVEC les indices mesurés sur un vrai Chromium passe", () => {
    // Si ce test tombait, le filtre effacerait du cockpit tous les visiteurs
    // Chrome, c'est-à-dire la majorité. C'est la garde la plus importante du
    // fichier, et c'est pour l'écrire qu'on a mesuré au lieu de supposer.
    const verdict = classerVisite(beacon({ "user-agent": UA_CHROME, ...INDICES_REELS }));
    expect(verdict.robot).toBe(false);
    expect(verdict.reason).toBeNull();
  });

  it("UNE NAVIGATION N'EST JAMAIS PUNIE DE SON ABSENCE D'INDICES", () => {
    // Mesuré : sur `sec-fetch-dest: document`, un vrai Chromium 156 n'envoie
    // PAS sec-ch-ua. La version naïve de la règle classait donc robot chaque
    // chargement de page. Elle est limitée aux sous-requêtes.
    const document = new Headers({ "user-agent": UA_CHROME, "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" });
    expect(classerVisite(document).robot).toBe(false);
  });

  it("un navigateur ancien, sans aucun en-tête Sec-Fetch, n'est pas puni non plus", () => {
    expect(classerVisite(new Headers({ "user-agent": UA_CHROME })).robot).toBe(false);
  });
});

describe("les cas légitimes ne sont pas cassés", () => {
  it("Safari iOS, qui n'implémente PAS les indices client, passe sur une sous-requête", () => {
    // Safari et Firefox n'implémentent pas les indices client : exiger
    // sec-ch-ua d'eux effacerait tous les visiteurs iPhone, c'est-à-dire le
    // téléphone de la cible du produit.
    expect(classerVisite(beacon({ "user-agent": UA_IPHONE })).robot).toBe(false);
  });

  it("LES NAVIGATEURS INTÉGRÉS SONT HORS DE LA RÈGLE, indices ou pas", () => {
    // C'est ce test qui a changé le code. Le navigateur intégré d'Instagram
    // sur Android annonce « Chrome/139 » : la première version de la règle le
    // classait robot dès qu'il n'envoyait pas sec-ch-ua. Or je n'ai pas pu
    // MESURER s'il les envoie — et s'il ne les envoie pas, la règle effaçait
    // du cockpit le trafic des DM, celui dont ce produit vit.
    //
    // On n'écarte pas ce qu'on n'a pas mesuré.
    expect(classerVisite(beacon({ "user-agent": UA_INSTAGRAM })).robot).toBe(false);
    const tiktok = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview";
    expect(classerVisite(beacon({ "user-agent": tiktok })).robot).toBe(false);
  });

  it("le navigateur intégré Instagram sur ANDROID est du Chromium : il envoie ses indices", () => {
    const verdict = classerVisite(beacon({ "user-agent": UA_INSTAGRAM, ...INDICES_REELS }));
    expect(verdict.robot).toBe(false);
    expect(verdict.agent_signature).toContain("instagram-");
  });

  it("LE NAVIGATEUR DE MESURE N'EST PAS UN ROBOT : il est interne, et compté à part", () => {
    // Le classer robot le ferait disparaître deux fois, et rendrait les
    // passages de mesure invisibles — alors qu'on veut pouvoir les compter
    // (lib/telemetry/internal.ts : « la ligne est ÉCRITE, marquée interne »).
    //
    // LE User-Agent EST CELUI DU SCRIPT, PAS LE JETON SEUL, et c'est la
    // mutation qui l'a imposé : avec le jeton nu, retirer l'exemption ne
    // cassait rien — « NegoscoreMesure/1 » ne contient pas « Chrome/ », donc
    // la règle des indices ne le voyait pas. Le vrai agent, lui, est un
    // Chrome complet suivi du jeton, et il serait classé « sans_indices »
    // sans cette exemption. Le test ne prouvait rien ; maintenant si.
    const script = readFileSync("scripts/mesure-pages.mjs", "utf8");
    const UA_MESURE = `Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 ${MEASURE_AGENT_TOKEN}`;
    // Le script compose bien son agent comme ça : si la ligne change, le
    // test doit tomber plutôt que d'éprouver une chaîne imaginaire.
    expect(script).toContain("Chrome/139.0.0.0 Mobile Safari/537.36 ${MEASURE_AGENT_TOKEN}");
    const verdict = classerVisite(beacon({ "user-agent": UA_MESURE }));
    expect(verdict.robot).toBe(false);
    expect(verdict.reason).toBeNull();
  });
});

describe("les robots qui se déclarent", () => {
  it("un robot nommé reste reconnu, et sa raison le dit", () => {
    const verdict = classerVisite(beacon({ "user-agent": UA_GOOGLEBOT }));
    expect(verdict.robot).toBe(true);
    expect(verdict.reason).toBe("declare");
  });

  it("une requête SANS User-Agent est un robot : aucun navigateur n'en omet", () => {
    const verdict = classerVisite(beacon());
    expect(verdict.robot).toBe(true);
    expect(verdict.reason).toBe("sans_agent");
    expect(verdict.agent_signature).toBeNull();
  });

  it("UN AGENT QUI SIGNE SES REQUÊTES SE DÉCLARE (web bot auth)", () => {
    // Brouillon IETF draft-ietf-webbotauth-httpsig-protocol : un agent
    // automatique prouve son identité par Signature-Agent + Signature-Input.
    // On ne vérifie pas la signature — aller chercher un annuaire de clés à
    // chaque page coûterait un appel réseau, et une signature contrefaite ne
    // servirait qu'à se faire écarter.
    for (const entete of ["signature-agent", "signature-input"]) {
      const verdict = classerVisite(beacon({ "user-agent": UA_CHROME, ...INDICES_REELS, [entete]: "sig1=:abc:" }));
      expect(verdict.robot, entete).toBe(true);
      expect(verdict.reason, entete).toBe("signature");
    }
  });

  it("un préchargement n'est personne qui regarde", () => {
    for (const [nom, valeur] of [["sec-purpose", "prefetch;anonymous-client-ip"], ["purpose", "prefetch"], ["sec-purpose", "prerender"]]) {
      const verdict = classerVisite(beacon({ "user-agent": UA_CHROME, ...INDICES_REELS, [nom]: valeur }));
      expect(verdict.robot, `${nom}=${valeur}`).toBe(true);
      expect(verdict.reason, `${nom}=${valeur}`).toBe("prefetch");
    }
  });

  it("LA RAISON PRÉCÈDE TOUJOURS : un robot nommé l'est par son nom, pas par ses indices", () => {
    // L'ordre compte pour la LECTURE : « declare » se vérifie en regardant la
    // liste, « sans_indices » demande d'y réfléchir. Un Googlebot sans
    // indices doit dire « declare ».
    expect(classerVisite(beacon({ "user-agent": UA_GOOGLEBOT })).reason).toBe("declare");
  });

  it("chaque raison a une étiquette lisible, et la liste est fermée", () => {
    for (const raison of ROBOT_REASONS) {
      expect(ROBOT_LABEL[raison], raison).toBeTruthy();
      expect(ROBOT_LABEL[raison].length, raison).toBeGreaterThan(3);
    }
    expect(Object.keys(ROBOT_LABEL).sort()).toEqual([...ROBOT_REASONS].sort());
  });
});

describe("l'empreinte de l'agent", () => {
  it("JAMAIS LE User-Agent BRUT : courte, sans espace, trois parties", () => {
    for (const userAgent of [UA_CHROME, UA_IPHONE, UA_INSTAGRAM, UA_GOOGLEBOT]) {
      const signature = signatureAgent(new Headers(), userAgent) as string;
      expect(signature, userAgent).not.toContain(" ");
      expect(signature.length, userAgent).toBeLessThanOrEqual(60);
      expect(signature.split("|"), userAgent).toHaveLength(3);
      // Et elle ne contient aucun morceau reconnaissable de la chaîne.
      expect(signature, userAgent).not.toContain("AppleWebKit");
      expect(signature, userAgent).not.toContain("Mozilla");
    }
  });

  it("elle nomme la famille, la version majeure, la plateforme et le format", () => {
    expect(signatureAgent(new Headers(), UA_CHROME)).toBe("chrome-141|windows|bureau");
    expect(signatureAgent(new Headers(), UA_IPHONE)).toBe("safari-17|ios|mobile");
    expect(signatureAgent(new Headers(), UA_INSTAGRAM)).toBe("instagram-139|android|mobile");
  });

  it("AUCUNE VERSION MINEURE : deux Chrome 141 différents donnent la MÊME forme", () => {
    // C'est ce qui l'empêche d'être un identifiant. 141.0.7390.54 et
    // 141.0.7390.99 sont deux appareils distinguables ; « chrome-141 » non.
    const a = UA_CHROME.replace("141.0.0.0", "141.0.7390.54");
    const b = UA_CHROME.replace("141.0.0.0", "141.0.7390.99");
    expect(signatureAgent(new Headers(), a)).toBe(signatureAgent(new Headers(), b));
  });

  it("l'indice client passe avant la chaîne pour le format", () => {
    // Il est produit indépendamment du User-Agent : plus fiable.
    const entetes = new Headers({ "sec-ch-ua-mobile": "?1" });
    expect(signatureAgent(entetes, UA_CHROME)).toBe("chrome-141|windows|mobile");
  });

  it("sans User-Agent, pas de forme : une absence n'est pas une valeur", () => {
    expect(signatureAgent(new Headers(), null)).toBeNull();
    expect(signatureAgent(new Headers(), "")).toBeNull();
  });
});

// ─── CE QUE L'ÉCRAN DOIT DIRE ──────────────────────────────────────────────

function dashboard(patch: Partial<DashboardData> = {}): DashboardData {
  return {
    counts: {}, excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
    feedback: { total: 0, fair: 0, not_fair: 0 },
    purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
    timeseries: [], acquisition: [], guides: [], example: { total: 0, direct: 0 }, tier_changes: [],
    engagement: [], engagement_scroll: [],
    robots: { visits: 0, reasons: [] }, agents: [],
    ...patch,
  };
}

describe("l'admin affiche LES DEUX nombres", () => {
  const constat = dashboard({
    counts: { landing_view: 3 },
    robots: { visits: 26, reasons: [{ reason: "sans_indices", visits: 26 }] },
  });

  it("une tuile pour les visites humaines, une autre pour les robots écartés", () => {
    const tiles = dashboardTiles(constat);
    const humaines = tiles.find((t) => t.label === "Visites humaines");
    const robots = tiles.find((t) => t.label === "Robots écartés");
    expect(humaines?.value).toBe("3");
    expect(robots?.value).toBe("26");
    // CÔTE À CÔTE À L'ÉCRAN, et pas seulement présents tous les deux : le
    // cockpit rend d'abord les tuiles qui portent une série (quatre colonnes),
    // puis les autres (trois colonnes), juste en dessous. « Visites humaines »
    // ouvre le premier bloc, « Robots écartés » le second : le second nombre
    // tombe donc sous le premier. Un nombre de robots qu'il faudrait aller
    // chercher ailleurs ne servirait à rien.
    expect(tiles.filter((t) => t.series)[0]).toBe(humaines);
    expect(tiles.filter((t) => !t.series)[0]).toBe(robots);
    // Et la tuile porte ses raisons : le bloc secondaire rend les indices.
    expect(robots?.hint).toContain("Chrome sans indices client");
  });

  it("LA TUILE DES VISITES DIT QUE LES ROBOTS SONT EXCLUS", () => {
    // Elle comptait des robots jusqu'ici sans que l'indice le dise. Un nombre
    // dont la définition a changé doit le dire à l'écran.
    const tile = dashboardTiles(constat).find((t) => t.label === "Visites humaines");
    expect(tile?.hint).toContain("robots exclus");
  });

  it("SI LE FILTRE SE TROMPE, LA RAISON EST ÉCRITE", () => {
    // « 26 sans indices client » et « 26 robots qui se nomment » ne demandent
    // pas la même vérification. Un total seul ne permettrait pas de voir
    // laquelle.
    expect(robotHint(constat)).toContain("26 Chrome sans indices client");
    expect(robotHint(dashboard())).toContain("aucune visite écartée");
  });

  it("la part se lit sur le TOTAL PRÉSENTÉ, jamais sur les visites humaines", () => {
    // 26 robots pour 3 humains : rapporté aux humains, ça donnerait 867 %.
    // Rapporté aux 29 présentées, 90 % — et c'est le nombre qui se lit.
    const texte = robotNotice(constat);
    expect(texte).toContain("26 visite(s) écartée(s) sur 29 présentée(s)");
    expect(texte).toContain("90 %");
  });

  it("LA NOTICE DIT QUE RIEN N'EST PERDU : le classement se révise", () => {
    expect(robotNotice(constat)).toContain("restent en base");
  });

  it("un jour sans personne et avec des robots n'affiche pas un pourcentage absurde", () => {
    const texte = robotNotice(dashboard({ robots: { visits: 4, reasons: [] } }));
    expect(texte).toContain("4 visite(s) écartée(s) sur 4 présentée(s)");
    expect(texte).toContain("100 %");
  });

  it("le compteur de robots compte les MÊMES événements que les visites", () => {
    // Sinon les deux nombres de la tuile ne seraient pas comparables, et
    // c'est exactement le défaut de la #129 : deux nombres appelés
    // « Visites » sur le même écran, sans rien pour dire lequel était bon.
    expect(VISIT_EVENTS).toEqual(["landing_view", "pricing_view", "guide_view", "example_view"]);
    expect(visitCount(dashboard({ counts: { landing_view: 2, example_view: 1, analysis_started: 9 } }))).toBe(3);
  });
});

// ─── LA LIGNE RÉELLEMENT ÉCRITE ────────────────────────────────────────────

const ecrites = vi.hoisted(() => ({
  lignes: [] as Array<Record<string, unknown>>,
  entetes: {} as Record<string, string>,
  horsContexte: false,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (ecrites.horsContexte) throw new Error("hors contexte de requête");
    return new Headers(ecrites.entetes);
  },
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string) => (table === "telemetry_salts" ? [{ day: "2026-11-14", salt: "b".repeat(64) }] : []),
    insertIfAbsent: async (table: string, row: Record<string, unknown>) => {
      if (table === "product_events") ecrites.lignes.push(row);
      return undefined;
    },
  };
});

const { recordProductEvent, ROBOT_CLASSIFIED_EVENTS } = await import("@/lib/analytics/first-party");

beforeEach(() => {
  ecrites.lignes = [];
  ecrites.entetes = { "user-agent": UA_CHROME, "sec-fetch-dest": "empty", "x-forwarded-for": "203.0.113.9" };
  ecrites.horsContexte = false;
  vi.stubEnv("INTERNAL_COOKIE_SECRET", "secret-de-test");
});

describe("la ligne écrite porte le verdict, et reste écrite", () => {
  it("UN ROBOT N'EST PLUS JETÉ : la ligne existe, marquée, avec sa raison", async () => {
    await recordProductEvent({ event: "landing_view", attribution: { path: "/" } });
    expect(ecrites.lignes).toHaveLength(1);
    expect(ecrites.lignes[0]).toMatchObject({
      event_name: "landing_view",
      robot: true,
      robot_reason: "sans_indices",
      agent_signature: "chrome-141|windows|bureau",
    });
  });

  it("une visite humaine porte robot = false et AUCUNE raison", async () => {
    ecrites.entetes = { ...ecrites.entetes, ...INDICES_REELS };
    await recordProductEvent({ event: "landing_view", attribution: { path: "/" } });
    expect(ecrites.lignes[0]).toMatchObject({ robot: false, robot_reason: null });
    expect(ecrites.lignes[0].agent_signature).toBe("chrome-141|windows|bureau");
  });

  it("L'EMPREINTE DE L'AGENT EST ÉCRITE MÊME POUR UN HUMAIN, et c'est elle qui tranche", async () => {
    // `visitor` suit l'adresse IP : il change à chaque visite d'un client qui
    // tourne ses adresses, et fait ressembler un robot à vingt-six personnes.
    // La forme d'agent, elle, ne bouge pas.
    ecrites.entetes = { ...ecrites.entetes, ...INDICES_REELS };
    await recordProductEvent({ event: "landing_view", attribution: { path: "/" } });
    const premiere = ecrites.lignes[0];
    ecrites.entetes = { ...ecrites.entetes, "x-forwarded-for": "198.51.100.4" };
    await recordProductEvent({ event: "landing_view", attribution: { path: "/" } });
    const seconde = ecrites.lignes[1];
    expect(premiere.visitor).not.toBe(seconde.visitor);
    expect(premiere.agent_signature).toBe(seconde.agent_signature);
  });

  it("UN ACHAT N'EST JAMAIS CLASSÉ ROBOT, même écrit depuis une requête de serveur", async () => {
    // Le webhook Whop écrit purchase_completed depuis une requête de Whop,
    // qui porte un User-Agent de serveur que l'expression de la #120 peut
    // reconnaître. Un achat réel classé robot disparaîtrait du revenu.
    ecrites.entetes = { "user-agent": "Whop-Webhook/1.0 (go-http-client)" };
    await recordProductEvent({ event: "purchase_completed", userId: "u1" });
    expect(ecrites.lignes[0]).toMatchObject({ robot: false, robot_reason: null, agent_signature: null });
  });

  it("la liste des événements classés ne contient QUE des arrivées mesurées", async () => {
    for (const event of ROBOT_CLASSIFIED_EVENTS) {
      expect(event, event).toMatch(/_view$|^page_engagement$/);
    }
    // Les quatre pages d'arrivée du produit y sont, plus l'arrivée sur une
    // analyse et le relevé de comportement.
    for (const event of VISIT_EVENTS) expect(ROBOT_CLASSIFIED_EVENTS, event).toContain(event);
    expect(ROBOT_CLASSIFIED_EVENTS).toContain("page_engagement");
    // Et rien qui porte de l'argent ou un compte.
    for (const interdit of ["purchase_completed", "checkout_started", "signup", "analysis_started"]) {
      expect(ROBOT_CLASSIFIED_EVENTS as readonly string[], interdit).not.toContain(interdit);
    }
  });

  it("HORS CONTEXTE DE REQUÊTE, rien n'est classé robot", async () => {
    // Tâche planifiée, rattrapage : aucun navigateur, donc rien à classer.
    // Jamais robot par défaut — une ligne écartée à tort ne se rattrape pas.
    ecrites.horsContexte = true;
    await recordProductEvent({ event: "landing_view", attribution: { path: "/" } });
    expect(ecrites.lignes).toHaveLength(1);
    expect(ecrites.lignes[0]).toMatchObject({ robot: false, robot_reason: null, agent_signature: null });
  });

  it("une requête SANS User-Agent est classée, elle : c'est « sans_agent »", async () => {
    ecrites.entetes = { "sec-fetch-dest": "empty" };
    await recordProductEvent({ event: "landing_view", attribution: { path: "/" } });
    expect(ecrites.lignes[0]).toMatchObject({ robot: true, robot_reason: "sans_agent", agent_signature: null });
  });
});
