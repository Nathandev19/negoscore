import { beforeEach, describe, expect, it, vi } from "vitest";
import { sentencesOf } from "@/lib/negotiation/points";
import { loadScenarios, readingOf, scenarioContext } from "@/lib/negotiation/scenarios";
import type { TurnPayload, TurnReading } from "@/lib/negotiation/types";

// Mission #080 — les gardes d'un tour de négociation, traversées par la vraie
// route. Depuis la mission #080 ter, un tour ne consomme ni crédit ni quota :
// l'analyse de l'offre couvre toute la négociation. Gardes qui restent : compte
// connecté propriétaire de l'analyse, filet horaire, clé d'idempotence, cinq
// tours au plus, refus des textes hors sujet.

const scenarios = loadScenarios();
const byId = (suffix: string) => scenarios.find((s) => s.id.endsWith(suffix))!;
const ANALYSIS_ID = "11111111-1111-4111-8111-111111111111";
const USER = { id: "u1", email: "nina@exemple.test" };

// Mission #100, point 2 — le texte de l'offre du scénario 01, écrit comme une
// marque l'écrit : 300 €, 2 TikTok, 60 jours, 6 mois de droits. C'est de LÀ que
// doivent venir les citations des points réglés par l'offre.
const OFFRE_COLLEE = vi.hoisted(
  () =>
    "Bonjour, on te propose 300 € pour 2 vidéos TikTok. Le paiement se fait à 60 jours après réception. On souhaite les droits pour les diffuser en publicité pendant 6 mois. Les retouches sont illimitées.",
);

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  // Tables lues ou écrites : aucune table de crédits ou de quota ne doit y figurer.
  tables: [] as string[],
  modelCalls: 0,
  reading: null as unknown,
  modelError: null as Error | null,
  rows: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  guardReleased: 0,
  // Mission #102 : un échange ne doit plus frapper le filet horaire du tout.
  guardHits: 0,
  // Mission #080 bis : messages enregistrés comme envoyés, et ce que le modèle a reçu.
  sent: [] as Array<{ analysis_id: string; turn_number: number; text: string; source: string; updated_at: string }>,
  lastMessages: [] as string[],
}));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => state.user));
vi.mock("@/lib/analysis/load", async () => {
  const { scenarioContext: context, loadScenarios: load } = await import("@/lib/negotiation/scenarios");
  const original = context(load()[0]).original;
  return {
    loadResultForViewer: async (id: string, viewer: { user: unknown }) =>
      id === "11111111-1111-4111-8111-111111111111" && viewer.user
        ? { analysis: original, unlocked: true, sourceRemoved: false, sourceType: "text", sourceText: OFFRE_COLLEE }
        : null,
  };
});
vi.mock("@/lib/llm/turn", () => ({
  readBrandReply: async (input: { lastMessage: string }) => {
    state.modelCalls += 1;
    state.lastMessages.push(input.lastMessage);
    if (state.modelError) throw state.modelError;
    return { reading: state.reading, usage: { model: "test", costEur: 0.001, latencyMs: 5 } };
  },
}));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => {
    state.guardHits += 1;
    return { allowed: true, count: 1, retryInMinutes: 60 };
  },
  releaseUsageGuard: async () => {
    state.guardReleased += 1;
  },
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      state.tables.push(table);
      if (table === "negotiation_sent_messages") return state.sent;
      if (table !== "negotiation_turns") return [];
      const key = query.match(/idempotency_key=eq\.([^&]+)/)?.[1];
      if (key) return state.rows.filter((r) => r.idempotency_key === decodeURIComponent(key));
      return state.rows.map((r) => ({ ...r, created_at: "2026-09-19T10:00:00.000Z" }));
    },
    insertRow: async (table: string, row: Record<string, unknown>) => {
      state.tables.push(table);
      if (table !== "negotiation_turns") throw new Error(table);
      const clash = state.rows.some((r) => r.kind === "reply" && r.turn_number === row.turn_number && row.kind === "reply");
      if (clash) throw new actual.SupabaseRequestError("doublon", 409, "23505");
      const saved = { id: `t${state.rows.length + 1}`, ...row };
      state.rows.push(saved);
      return saved;
    },
    upsertRow: async (table: string, row: Record<string, unknown>) => {
      state.tables.push(table);
      if (table !== "negotiation_sent_messages") throw new Error(table);
      state.sent = state.sent.filter((m) => m.turn_number !== row.turn_number);
      state.sent.push(row as (typeof state.sent)[number]);
    },
    deleteRows: async (_table: string, filter: string) => {
      const id = filter.replace("id=eq.", "");
      state.deleted.push(id);
      state.rows = state.rows.filter((r) => r.id !== id);
    },
  };
});

const { POST } = await import("@/app/api/analyses/[id]/tours/route");
const { POST: CONCLUDE } = await import("@/app/api/analyses/[id]/conclusion/route");

function send(body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/analyses/${ANALYSIS_ID}/tours`, { method: "POST", body: JSON.stringify({ tier: "confirmed", ...body }) }),
    { params: Promise.resolve({ id: ANALYSIS_ID }) },
  );
}

function use(suffix: string): string {
  const scenario = byId(suffix);
  state.reading = readingOf(scenario, scenarioContext(scenario).original) as TurnReading;
  return scenario.reponse_marque;
}

beforeEach(() => {
  state.user = USER;
  state.tables = [];
  state.modelCalls = 0;
  state.modelError = null;
  state.rows = [];
  state.deleted = [];
  state.guardReleased = 0;
  state.guardHits = 0;
  state.sent = [];
  state.lastMessages = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
});

// Aucune table de droits : ni crédits, ni gratuité, ni analyses comptées.
const BILLING_TABLES = ["credits", "free_usage", "analyses", "deals", "whop_events"];
const touchedBilling = () => state.tables.filter((table) => BILLING_TABLES.includes(table));

describe("tour de négociation — gardes", () => {
  it("sans compte : refusé avant tout, rien d'appelé", async () => {
    state.user = null;
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(401);
    expect(state.modelCalls).toBe(0);
  });

  it("#080 ter, C1 et C3 — un tour réussi : enregistré sur CETTE analyse, sans toucher ni crédit ni quota, quelle que soit la formule", async () => {
    const reply = use("acceptation-partielle");
    const r = await send({ reply, idempotencyKey: "cle-de-test-0000000001" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ turnNumber: 2 });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ analysis_id: ANALYSIS_ID, user_id: USER.id, kind: "reply", turn_number: 2, brand_reply: reply });
    expect(touchedBilling()).toEqual([]);
  });

  it("#102, partie B — un échange passe, même si le filet horaire refusait tout", async () => {
    const reply = use("acceptation-partielle");
    const r = await send({ reply, idempotencyKey: "cle-de-test-0000000102" });
    expect(r.status).toBe(200);
    // La route ne consulte plus ce compteur : elle ne peut plus être arrêtée
    // par lui au milieu d'une négociation déjà ouverte.
    expect(state.guardHits).toBe(0);
    expect(state.rows).toHaveLength(1);
  });

  it("#100, point 2 — le texte collé atteint le moteur : un point réglé par l'offre porte une phrase de l'offre", async () => {
    const reply = use("acceptation-partielle");
    const r = await send({ reply, idempotencyKey: "cle-de-test-0000000100" });
    expect(r.status).toBe(200);
    const payload = state.rows[0].payload as TurnPayload;
    const depuisLOffre = payload.points.filter((point) => point.turn === 1);
    expect(depuisLOffre.length).toBeGreaterThan(0);
    for (const point of depuisLOffre) {
      expect(sentencesOf(OFFRE_COLLEE)).toContain(point.quote);
    }
  });

  it("#080 ter — la route ne consulte plus aucun droit : ni réservation, ni décompte", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/analyses/[id]/tours/route.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/entitlement|reserve|commit\(|paywall|crédit/);
  });

  it("D4 — le même tour envoyé deux fois (même clé) n'appelle le modèle qu'une fois et n'enregistre qu'un tour", async () => {
    const reply = use("acceptation-partielle");
    await send({ reply, idempotencyKey: "cle-de-test-0000000002" });
    const again = await send({ reply, idempotencyKey: "cle-de-test-0000000002" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ turnNumber: 2, replayed: true });
    expect(state.modelCalls).toBe(1);
    expect(state.rows).toHaveLength(1);
  });

  it("B3 — texte hors sujet : on le dit, rien n'est enregistré", async () => {
    const r = await send({ reply: use("hors-sujet") });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("ne ressemble pas à une réponse de la marque");
    expect(state.rows).toEqual([]);
    // Mission #102, partie B — un échange ne compte plus dans le filet
    // horaire : il n'y a donc rien à lui rendre après un échec.
    expect(state.guardHits).toBe(0);
    expect(state.guardReleased).toBe(0);
  });

  it("échec du modèle : rien d'enregistré, le filet horaire est rendu, le message ne parle d'aucun crédit", async () => {
    const { ExtractionError } = await import("@/lib/llm/extract");
    state.modelError = new ExtractionError("sortie invalide");
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(503);
    expect((await r.json()).error).not.toMatch(/crédit|décompt|droit/);
    expect(state.rows).toEqual([]);
    // Mission #102, partie B — un échange ne compte plus dans le filet
    // horaire : il n'y a donc rien à lui rendre après un échec.
    expect(state.guardHits).toBe(0);
    expect(state.guardReleased).toBe(0);
  });

  it("B4, C5 — cinq tours au plus : le tour 6 est refusé, sans appel au modèle", async () => {
    for (let turn = 2; turn <= 5; turn++) {
      await send({ reply: use("reponse-vague") });
    }
    expect(state.rows.map((r) => r.turn_number)).toEqual([2, 3, 4, 5]);
    const calls = state.modelCalls;
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(409);
    expect(state.modelCalls).toBe(calls);
    expect(touchedBilling()).toEqual([]);
  });

  it("C — après une acceptation, l'échange est conclu : plus de tour", async () => {
    await send({ reply: use("acceptation-franche") });
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(409);
    expect((await r.json()).reason).toBe("concluded");
  });

  it("« J'accepte ces termes » : conclusion enregistrée, aucun appel au modèle, ouverte sans condition de formule", async () => {
    const calls = state.modelCalls;
    const r = await CONCLUDE(
      new Request(`http://localhost/api/analyses/${ANALYSIS_ID}/conclusion`, { method: "POST", body: JSON.stringify({ tier: "confirmed" }) }),
      { params: Promise.resolve({ id: ANALYSIS_ID }) },
    );
    expect(r.status).toBe(200);
    expect(state.rows.at(-1)).toMatchObject({ kind: "conclusion" });
    expect(state.modelCalls).toBe(calls);
    expect(touchedBilling()).toEqual([]);
    // Et plus de tour ensuite.
    expect((await send({ reply: use("reponse-vague") })).status).toBe(409);
  });
});

// ─── Mission #080 bis, B5 — le message réellement envoyé ─────────────────────

const { POST: RECORD } = await import("@/app/api/analyses/[id]/message-envoye/route");
const { recomputeForTier } = await import("@/lib/analysis/recompute");

function copy(turn: number, text: string) {
  return RECORD(
    new Request(`http://localhost/api/analyses/${ANALYSIS_ID}/message-envoye`, { method: "POST", body: JSON.stringify({ turn, text }) }),
    { params: Promise.resolve({ id: ANALYSIS_ID }) },
  );
}

const proposedFirst = () => {
  const original = scenarioContext(byId("reponse-vague")).original;
  return recomputeForTier(original, "confirmed").ready_to_send_message?.text ?? "";
};

describe("B5 — le tour suivant lit la réponse à la lumière du message réellement envoyé", () => {
  it("message copié tel quel : c'est lui que reçoit le tour suivant", async () => {
    expect((await copy(1, proposedFirst())).status).toBe(200);
    await send({ reply: use("reponse-vague") });
    expect(state.lastMessages).toEqual([proposedFirst()]);
    expect(state.sent[0]).toMatchObject({ turn_number: 1, source: "copied" });
  });

  it("message modifié puis copié : le texte modifié, pas celui proposé", async () => {
    const edited = `${proposedFirst()}

PS : je peux aussi livrer une version courte.`;
    await copy(1, edited);
    await send({ reply: use("reponse-vague") });
    expect(state.lastMessages).toEqual([edited]);
  });

  it("jamais copié : le message proposé reste l'hypothèse", async () => {
    await send({ reply: use("reponse-vague") });
    expect(state.lastMessages).toEqual([proposedFirst()]);
    expect(state.sent).toEqual([]);
  });

  it("corrigé à la main au moment de coller la réponse : la correction l'emporte, et elle est retenue", async () => {
    await copy(1, proposedFirst());
    const corrected = "Bonjour, mon tarif pour ce projet est de 900 €, droits pub compris. Belle journée";
    await send({ reply: use("reponse-vague"), sentMessage: corrected });
    expect(state.lastMessages).toEqual([corrected]);
    expect(state.sent.find((m) => m.turn_number === 1)).toMatchObject({ text: corrected, source: "corrected" });
  });

  it("au tour suivant, c'est le message du tour 2 copié qui compte, pas celui du tour 1", async () => {
    await copy(1, "Message du tour 1");
    await send({ reply: use("reponse-vague") });
    await copy(2, "Message du tour 2, modifié avant envoi");
    await send({ reply: use("reponse-vague") });
    expect(state.lastMessages).toEqual(["Message du tour 1", "Message du tour 2, modifié avant envoi"]);
  });

  it("B4 — enregistrer un message ne consomme rien et n'appelle pas le modèle", async () => {
    await copy(1, "Un message");
    expect(touchedBilling()).toEqual([]);
    expect(state.modelCalls).toBe(0);
  });

  it("refusé pour un tour qui n'existe pas encore, pour un texte vide, et sans compte", async () => {
    expect((await copy(3, "texte")).status).toBe(404);
    expect((await copy(1, "   ")).status).toBe(400);
    state.user = null;
    expect((await copy(1, "texte")).status).toBe(401);
    expect(state.sent).toEqual([]);
  });
});
