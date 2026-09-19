import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadScenarios, readingOf, scenarioContext } from "@/lib/negotiation/scenarios";
import type { TurnReading } from "@/lib/negotiation/types";

// Mission #080, D — les gardes d'un tour de négociation, traversées par la
// vraie route : compte obligatoire, formule payante, crédit décompté une seule
// fois et seulement après l'enregistrement, rien de décompté pour un texte hors
// sujet ou un échec du modèle, rejeu par clé d'idempotence, cinq tours au plus.

const scenarios = loadScenarios();
const byId = (suffix: string) => scenarios.find((s) => s.id.endsWith(suffix))!;
const ANALYSIS_ID = "11111111-1111-4111-8111-111111111111";
const USER = { id: "u1", email: "nina@exemple.test" };

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  plan: "pack" as "free" | "pack" | "pro",
  balance: 3,
  commits: 0,
  releases: 0,
  modelCalls: 0,
  reading: null as unknown,
  modelError: null as Error | null,
  rows: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  guardReleased: 0,
  // Mission #080 bis : messages enregistrés comme envoyés, et ce que le modèle a reçu.
  sent: [] as Array<{ analysis_id: string; turn_number: number; text: string; source: string; updated_at: string }>,
  lastMessages: [] as string[],
}));

vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => state.user }));
vi.mock("@/lib/analysis/load", async () => {
  const { scenarioContext: context, loadScenarios: load } = await import("@/lib/negotiation/scenarios");
  const original = context(load()[0]).original;
  return {
    loadResultForViewer: async (id: string, viewer: { user: unknown }) =>
      id === "11111111-1111-4111-8111-111111111111" && viewer.user ? { analysis: original, unlocked: true } : null,
  };
});
vi.mock("@/lib/billing/entitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/entitlement")>()),
  reserveTurn: async () => {
    if (state.plan === "free") return { allowed: false, reason: "plan_required", message: "formule requise" };
    if (state.balance <= 0) return { allowed: false, reason: "no_credit", message: "plus de crédit" };
    return {
      allowed: true,
      plan: state.plan,
      commit: async () => {
        state.commits += 1;
        state.balance -= 1;
        return true;
      },
      release: async () => {
        state.releases += 1;
      },
    };
  },
}));
vi.mock("@/lib/llm/turn", () => ({
  readBrandReply: async (input: { lastMessage: string }) => {
    state.modelCalls += 1;
    state.lastMessages.push(input.lastMessage);
    if (state.modelError) throw state.modelError;
    return { reading: state.reading, usage: { model: "test", costEur: 0.001, latencyMs: 5 } };
  },
}));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => ({ allowed: true, count: 1, retryInMinutes: 60 }),
  releaseUsageGuard: async () => {
    state.guardReleased += 1;
  },
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (table === "negotiation_sent_messages") return state.sent;
      if (table !== "negotiation_turns") return [];
      const key = query.match(/idempotency_key=eq\.([^&]+)/)?.[1];
      if (key) return state.rows.filter((r) => r.idempotency_key === decodeURIComponent(key));
      return state.rows.map((r) => ({ ...r, created_at: "2026-09-19T10:00:00.000Z" }));
    },
    insertRow: async (table: string, row: Record<string, unknown>) => {
      if (table !== "negotiation_turns") throw new Error(table);
      const clash = state.rows.some((r) => r.kind === "reply" && r.turn_number === row.turn_number && row.kind === "reply");
      if (clash) throw new actual.SupabaseRequestError("doublon", 409, "23505");
      const saved = { id: `t${state.rows.length + 1}`, ...row };
      state.rows.push(saved);
      return saved;
    },
    upsertRow: async (table: string, row: Record<string, unknown>) => {
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
  state.plan = "pack";
  state.balance = 3;
  state.commits = 0;
  state.releases = 0;
  state.modelCalls = 0;
  state.modelError = null;
  state.rows = [];
  state.deleted = [];
  state.guardReleased = 0;
  state.sent = [];
  state.lastMessages = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
});

describe("tour de négociation — gardes", () => {
  it("sans compte : refusé avant tout, rien d'appelé", async () => {
    state.user = null;
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(401);
    expect(state.modelCalls).toBe(0);
  });

  it("D3 — compte gratuit : pas de tour suivant, modèle jamais appelé, rien enregistré", async () => {
    state.plan = "free";
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ paywall: true, reason: "plan_required" });
    expect(state.modelCalls).toBe(0);
    expect(state.rows).toEqual([]);
  });

  it("D1 — un tour réussi : enregistré sur CETTE analyse, un crédit décompté, après l'enregistrement", async () => {
    const reply = use("acceptation-partielle");
    const r = await send({ reply, idempotencyKey: "cle-de-test-0000000001" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ turnNumber: 2 });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ analysis_id: ANALYSIS_ID, user_id: USER.id, kind: "reply", turn_number: 2, brand_reply: reply });
    expect(state.commits).toBe(1);
    expect(state.balance).toBe(2);
  });

  it("D4 — le même tour envoyé deux fois (même clé) ne débite qu'un crédit et n'appelle le modèle qu'une fois", async () => {
    const reply = use("acceptation-partielle");
    await send({ reply, idempotencyKey: "cle-de-test-0000000002" });
    const again = await send({ reply, idempotencyKey: "cle-de-test-0000000002" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ turnNumber: 2, replayed: true });
    expect(state.modelCalls).toBe(1);
    expect(state.commits).toBe(1);
    expect(state.rows).toHaveLength(1);
  });

  it("B3 — texte hors sujet : on le dit, rien n'est enregistré ni décompté", async () => {
    const r = await send({ reply: use("hors-sujet") });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("Rien n'a été décompté");
    expect(state.rows).toEqual([]);
    expect(state.commits).toBe(0);
    expect(state.guardReleased).toBe(1);
  });

  it("échec du modèle : rien de décompté, le filet horaire est rendu", async () => {
    const { ExtractionError } = await import("@/lib/llm/extract");
    state.modelError = new ExtractionError("sortie invalide");
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(503);
    expect(state.commits).toBe(0);
    expect(state.rows).toEqual([]);
    expect(state.guardReleased).toBe(1);
  });

  it("B4 — cinq tours au plus : le tour 6 est refusé, sans appel au modèle", async () => {
    state.balance = 10;
    for (let turn = 2; turn <= 5; turn++) {
      await send({ reply: use("reponse-vague") });
    }
    expect(state.rows.map((r) => r.turn_number)).toEqual([2, 3, 4, 5]);
    const calls = state.modelCalls;
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(409);
    expect(state.modelCalls).toBe(calls);
  });

  it("C — après une acceptation, l'échange est conclu : plus de tour", async () => {
    await send({ reply: use("acceptation-franche") });
    const r = await send({ reply: use("reponse-vague") });
    expect(r.status).toBe(409);
    expect((await r.json()).reason).toBe("concluded");
  });

  it("D2 — « J'accepte ces termes » : conclusion enregistrée, aucun crédit, aucun appel au modèle", async () => {
    await send({ reply: use("reponse-vague") });
    const commits = state.commits;
    const calls = state.modelCalls;
    const r = await CONCLUDE(
      new Request(`http://localhost/api/analyses/${ANALYSIS_ID}/conclusion`, { method: "POST", body: JSON.stringify({ tier: "confirmed" }) }),
      { params: Promise.resolve({ id: ANALYSIS_ID }) },
    );
    expect(r.status).toBe(200);
    expect(state.rows.at(-1)).toMatchObject({ kind: "conclusion" });
    expect(state.commits).toBe(commits);
    expect(state.modelCalls).toBe(calls);
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
    state.balance = 10;
    await copy(1, "Message du tour 1");
    await send({ reply: use("reponse-vague") });
    await copy(2, "Message du tour 2, modifié avant envoi");
    await send({ reply: use("reponse-vague") });
    expect(state.lastMessages).toEqual(["Message du tour 1", "Message du tour 2, modifié avant envoi"]);
  });

  it("B4 — enregistrer un message ne consomme rien et n'appelle pas le modèle", async () => {
    await copy(1, "Un message");
    expect(state.commits).toBe(0);
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
