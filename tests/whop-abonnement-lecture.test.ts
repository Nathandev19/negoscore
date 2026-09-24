import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMembership } from "@/lib/whop/api";

// Mission #114, A4 — LIRE UN ABONNEMENT, EN TROIS ÉTATS.
//
// « Whop a répondu que cet abonnement n'existe pas » et « Whop n'a pas pu
// répondre » ne se valent pas quand il s'agit de créditer un compte : la
// première réponse est un fait, la seconde une ignorance. Les confondre ferait
// tomber en attente définitive un paiement rattachable, ou pire, ferait
// conclure une absence là où il n'y a qu'une panne. Même règle que la session
// de la mission #089 bis.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("WHOP_API_KEY", "cle-de-test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

describe("readMembership", () => {
  it("abonnement lisible : les metadata dont il a hérité sont rendues", async () => {
    fetchMock.mockReturnValue(json({ id: "mem_1", status: "active", metadata: { user_id: "u1", plan: "pro" } }));
    const read = await readMembership("mem_1");
    expect(read).toMatchObject({ kind: "found" });
    if (read.kind === "found") expect(read.membership.metadata).toEqual({ user_id: "u1", plan: "pro" });
  });

  it("abonnement sans metadata : lisible, mais rien à en tirer", async () => {
    fetchMock.mockReturnValue(json({ id: "mem_1", status: "active" }));
    const read = await readMembership("mem_1");
    expect(read.kind).toBe("found");
    if (read.kind === "found") expect(read.membership.metadata).toEqual({});
  });

  it("404 et 410 : Whop a répondu, l'abonnement n'existe pas", async () => {
    for (const status of [404, 410]) {
      fetchMock.mockReturnValue(json({ error: "not found" }, status));
      expect((await readMembership("mem_1")).kind, String(status)).toBe("absent");
    }
  });

  it("401, 429, 5xx : on n'a pas pu demander, et on ne devine pas", async () => {
    for (const status of [401, 403, 429, 500, 502, 503, 504]) {
      fetchMock.mockReturnValue(json({ error: "non" }, status));
      const read = await readMembership("mem_1");
      expect(read.kind, String(status)).toBe("unavailable");
      if (read.kind === "unavailable") expect(read.detail).toBe(`http_${status}`);
    }
  });

  it("le réseau tombe : indisponible, jamais absent", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const read = await readMembership("mem_1");
    expect(read.kind).toBe("unavailable");
    if (read.kind === "unavailable") expect(read.detail).toContain("fetch failed");
  });

  it("réponse 200 illisible : indisponible, pas « cet abonnement n'existe pas »", async () => {
    fetchMock.mockReturnValue(Promise.resolve(new Response("pas du json", { status: 200 })));
    expect((await readMembership("mem_1")).kind).toBe("unavailable");
    fetchMock.mockReturnValue(json({ status: "active" }));
    expect((await readMembership("mem_1")).kind).toBe("unavailable");
  });

  it("clé API absente : indisponible, et aucun appel n'est tenté", async () => {
    vi.stubEnv("WHOP_API_KEY", "");
    const read = await readMembership("mem_1");
    expect(read).toEqual({ kind: "unavailable", detail: "cle_absente" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("l'identifiant est encodé avant d'entrer dans l'adresse", async () => {
    fetchMock.mockReturnValue(json({ id: "mem_1" }));
    await readMembership("mem 1/../x");
    expect(String(fetchMock.mock.calls[0][0])).toContain("mem%201%2F..%2Fx");
  });
});
