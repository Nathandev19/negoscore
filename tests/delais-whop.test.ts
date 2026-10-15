import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Mission #195, B — LES APPELS WHOP ONT UN PLAFOND, ET UN DÉPASSEMENT NE
// RETIRE RIEN.
//
// Même classe de défaut que la #194, sur le chemin du PAIEMENT : celui où un
// blocage coûte le plus cher. Ce qui est vérifié ici n'est pas seulement que
// le plafond existe, mais que son dépassement emprunte EXACTEMENT les mêmes
// chemins qu'une panne réseau — parce que ces chemins-là sont déjà les bons,
// et qu'aucun d'eux ne retire un droit ni n'annule un abonnement.

const whop = vi.hoisted(() => ({
  mode: "ok" as "ok" | "delai" | "reseau" | "absent",
  appels: [] as Array<{ url: string; methode: string; aSignal: boolean }>,
}));

function timeoutError(): Error {
  // Ce que la plateforme rejette quand le signal de AbortSignal.timeout part :
  // une DOMException dont le NOM est « TimeoutError ».
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

const ABONNEMENT = {
  id: "mem_1",
  status: "active",
  cancel_at_period_end: false,
  renewal_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  metadata: {},
};

function faux(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  whop.appels.push({ url, methode: String(init?.method ?? "GET"), aSignal: Boolean(init?.signal) });
  if (whop.mode === "delai") return Promise.reject(timeoutError());
  if (whop.mode === "reseau") return Promise.reject(new TypeError("fetch failed"));
  if (whop.mode === "absent") return Promise.resolve(Response.json({ error: "not found" }, { status: 404 }));
  if (url.includes("/checkout_configurations")) {
    return Promise.resolve(Response.json({ id: "ch_1", purchase_url: "https://whop.com/checkout/ch_1/" }));
  }
  return Promise.resolve(Response.json(ABONNEMENT));
}

// Tout ce dont /api/resilier a besoin, SAUF lib/whop/api : c'est lui qu'on
// mesure, avec un vrai fetch simulé au niveau HTTP.
const base = vi.hoisted(() => ({
  credits: { plan: "pro", balance: 0, period_end: "", cancelled_at: null as string | null },
  ecritures: [] as Array<{ table: string; filter: string; patch: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => ({ id: "u1", email: "nina@exemple.test" })));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async () => [base.credits],
  updateRows: async (table: string, filter: string, patch: Record<string, unknown>) => {
    base.ecritures.push({ table, filter, patch });
    return [patch];
  },
}));
vi.mock("@/lib/billing/subscription", () => ({ findMembershipId: async () => "mem_1" }));
vi.mock("@/lib/email/send", () => ({ sendEmail: async () => undefined }));

const { createCheckoutUrl, cancelMembershipAtPeriodEnd, getMembership, readMembership } = await import("@/lib/whop/api");
const { DELAI_WHOP_MS } = await import("@/lib/reseau/delais");
const { POST: resilierPOST } = await import("@/app/api/resilier/route");

beforeEach(() => {
  vi.stubEnv("WHOP_API_KEY", "cle-whop-de-test");
  vi.stubEnv("WHOP_PLAN_PACK", "plan_pack");
  vi.stubEnv("WHOP_PLAN_PRO", "plan_pro");
  vi.stubGlobal("fetch", vi.fn(faux));
  whop.mode = "ok";
  whop.appels = [];
  base.credits = { plan: "pro", balance: 0, period_end: new Date(Date.now() + 60 * 86_400_000).toISOString(), cancelled_at: null };
  base.ecritures = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("A — le plafond est posé sur chaque appel Whop", () => {
  it("les trois appels portent un signal", async () => {
    await createCheckoutUrl({ plan: "pack", metadata: { user_id: "u1" }, redirectUrl: "https://negoscore.fr/merci" });
    await getMembership("mem_1");
    await readMembership("mem_1");
    expect(whop.appels).toHaveLength(3);
    for (const appel of whop.appels) expect(appel.aSignal, appel.url).toBe(true);
  });

  it("le plafond est de 10 s, comme la mission le fixe", () => {
    expect(DELAI_WHOP_MS).toBe(10_000);
  });

  it("l'en-tête de version d'API n'a pas bougé", async () => {
    const { readFileSync } = await import("node:fs");
    // Sans cet en-tête, la résiliation redevient immédiate au lieu de prendre
    // effet en fin de période.
    expect(readFileSync("lib/whop/api.ts", "utf8")).toContain('"Api-Version-Date": API_VERSION_DATE');
  });
});

describe("B — un dépassement produit EXACTEMENT ce qu'une panne réseau produit", () => {
  it("page de paiement : null dans les deux cas, donc aucune page qui n'ouvre à moitié", async () => {
    const options = { plan: "pack" as const, metadata: { user_id: "u1" }, redirectUrl: "https://negoscore.fr/merci" };
    whop.mode = "reseau";
    const surPanne = await createCheckoutUrl(options);
    whop.mode = "delai";
    const surDelai = await createCheckoutUrl(options);
    expect(surPanne).toBeNull();
    expect(surDelai).toBe(surPanne);
  });

  it("lecture d'abonnement : « unavailable » dans les deux cas, JAMAIS « absent »", async () => {
    whop.mode = "reseau";
    const surPanne = await readMembership("mem_1");
    whop.mode = "delai";
    const surDelai = await readMembership("mem_1");
    expect(surPanne.kind).toBe("unavailable");
    expect(surDelai.kind).toBe("unavailable");
    // « absent » voudrait dire « Whop a répondu que cet abonnement n'existe
    // pas » : c'est un FAIT, et le webhook en tire des conclusions. Un délai
    // dépassé n'est pas un fait, c'est une ignorance (mission #114).
    expect(surDelai.kind).not.toBe("absent");
    expect(surDelai.kind).not.toBe("found");
  });

  it("et par contraste, un vrai 404 reste « absent »", async () => {
    whop.mode = "absent";
    expect((await readMembership("mem_1")).kind).toBe("absent");
  });

  it("annulation : l'erreur se propage dans les deux cas, elle ne devient pas un null", async () => {
    // null signifierait « Whop a répondu que ça n'a pas marché ». Ce n'est pas
    // la même chose qu'une absence de réponse, et la route n'en tire pas les
    // mêmes conclusions.
    whop.mode = "reseau";
    await expect(cancelMembershipAtPeriodEnd("mem_1")).rejects.toThrow();
    whop.mode = "delai";
    await expect(cancelMembershipAtPeriodEnd("mem_1")).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

describe("C — AUCUN DROIT RETIRÉ, AUCUN ABONNEMENT ANNULÉ sur un dépassement", () => {
  const resilier = () => resilierPOST(new Request("http://localhost:3000/api/resilier", { method: "POST" }));
  const annulations = () => base.ecritures.filter((e) => e.table === "credits" && "cancelled_at" in e.patch);

  it("résiliation, délai dépassé : rien n'est écrit, l'abonnement reste en place", async () => {
    whop.mode = "delai";
    const reponse = await resilier();
    // La route répond, et elle répond « indisponible » — pas « résilié ».
    expect(reponse.headers.get("location")).toContain("erreur=indisponible");
    expect(reponse.headers.get("location")).not.toContain("etat=resilie");
    // ET SURTOUT : aucune écriture de cancelled_at.
    expect(annulations()).toEqual([]);
    expect(base.ecritures).toEqual([]);
  });

  it("le même dépassement n'avance pas non plus la fin d'accès", async () => {
    whop.mode = "delai";
    await resilier();
    for (const ecriture of base.ecritures) expect(ecriture.patch).not.toHaveProperty("period_end");
  });

  it("par contraste, quand Whop répond, la résiliation s'enregistre", async () => {
    whop.mode = "ok";
    const reponse = await resilier();
    expect(reponse.headers.get("location")).toContain("etat=resilie");
    expect(annulations()).toHaveLength(1);
  });

  it("une panne réseau produisait déjà ce comportement : le délai ne change rien", async () => {
    whop.mode = "reseau";
    await resilier();
    const surPanne = [...base.ecritures];
    base.ecritures = [];
    whop.mode = "delai";
    await resilier();
    expect(base.ecritures).toEqual(surPanne);
    expect(base.ecritures).toEqual([]);
  });
});

describe("D — le webhook, sur un dépassement, rejoue au lieu de conclure", () => {
  it("un abonnement illisible n'attache aucun compte, et ne retire donc rien", async () => {
    // readMembership rend « unavailable » : lib/billing/whop-events.ts en fait
    // un Attachment « unavailable », l'événement reste en attente et sera
    // rejoué. C'est la chaîne qui garantit qu'un délai ne retire pas un droit.
    whop.mode = "delai";
    const read = await readMembership("mem_1");
    expect(read.kind).toBe("unavailable");
    if (read.kind !== "unavailable") return;
    // Le détail nomme ce qui a cassé, plutôt que de laisser deviner.
    expect(read.detail.length).toBeGreaterThan(0);
  });

  it("le module ne traduit pas le délai en erreur typée d'un autre fournisseur", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/whop/api.ts", "utf8");
    // Le code SANS les commentaires : ils expliquent la règle, et l'expliquer
    // n'est pas l'enfreindre (même lecture que tests/vocabulaire-public).
    const code = source
      .split("\n")
      .filter((ligne) => !ligne.trim().startsWith("//"))
      .join("\n");
    // Le 504 de lib/supabase/server.ts n'a rien à faire ici : il changerait ce
    // qui se propage hors de membershipRequest.
    expect(code).not.toContain("SupabaseRequestError");
    expect(code).not.toContain("estDelaiDepasse");
    // Un seul helper partagé, pas une copie locale du plafond.
    expect(code).toContain('from "@/lib/reseau/delais"');
    expect(code).not.toContain("AbortSignal.timeout");
    expect(code).not.toMatch(/10_?000/);
  });
});
