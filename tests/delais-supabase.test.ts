import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #194, B — UN PLAFOND SUR CHAQUE APPEL, ET LE PIÈGE QUI VA AVEC.
//
// Aucun fetch du projet ne portait de délai. Ce qui est vérifié ici n'est pas
// seulement que le plafond existe, mais ce qu'un dépassement VEUT DIRE :
//
//   « on n'a PAS PU demander »        → unavailable, aucun cookie touché
//   « on a demandé, la réponse est non » → rejected, cookies effacés
//
// proxy.ts efface les cookies de session sur « rejected ». Un délai dépassé
// classé « rejected » déconnecterait quelqu'un pour un ralentissement de
// réseau — exactement ce que la mission #089 avait corrigé pour la panne, et
// qui reviendrait par la porte du délai.

const SUPABASE = "https://projet.supabase.test";

// Ce que fetch fait, par appel : répondre, ou dépasser le délai. Un
// dépassement se présente comme la plateforme le présente — une DOMException
// nommée « TimeoutError », rejetée par fetch quand le signal se déclenche.
const fake = vi.hoisted(() => ({ mode: "ok" as "ok" | "delai" | "refus", appels: [] as Array<{ url: string; aSignal: boolean }> }));

function timeoutError(): Error {
  // Node et les navigateurs rejettent avec une DOMException ; son NOM est ce
  // qui compte, et c'est lui que lib/supabase/delais.ts reconnaît.
  const erreur = new Error("The operation was aborted due to timeout");
  erreur.name = "TimeoutError";
  return erreur;
}

function faux(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fake.appels.push({ url, aSignal: Boolean(init?.signal) });
  if (fake.mode === "delai") return Promise.reject(timeoutError());
  if (fake.mode === "refus") return Promise.resolve(Response.json({ msg: "jeton invalide" }, { status: 401 }));
  if (url.includes("/token")) {
    return Promise.resolve(
      Response.json({ access_token: FRAIS, refresh_token: "r2", expires_in: 3600, user: { id: "u1", email: "nina@exemple.test" } }),
    );
  }
  if (url.includes("/auth/v1/user")) return Promise.resolve(Response.json({ id: "u1", email: "nina@exemple.test" }));
  return Promise.resolve(Response.json([]));
}

function jwt(secondes: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondes })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}
const FRAIS = jwt(3600);

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { avecDelai, estDelaiDepasse, DELAI_AUTH_MS, DELAI_POSTGREST_MS, DELAI_STORAGE_MS } = await import("@/lib/reseau/delais");
const { checkAccessToken, refreshSessionOutcome, sessionFromAccessToken } = await import("@/lib/auth/session");
const { sessionState } = await import("@/lib/auth/session-state");
const { selectRows, countRows, SupabaseRequestError } = await import("@/lib/supabase/server");
const { proxy } = await import("@/proxy");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon-de-test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle-de-service-de-test");
  vi.stubGlobal("fetch", vi.fn(faux));
  fake.mode = "ok";
  fake.appels = [];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("A — le plafond est réellement armé", () => {
  it("avecDelai pose un signal qui se déclenche tout seul", async () => {
    const { signal } = avecDelai({}, 15);
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as Error | undefined)?.name).toBe("TimeoutError");
  });

  it("il n'écrase pas le signal de l'appelant : les deux gardent leur effet", () => {
    const propre = new AbortController();
    const { signal } = avecDelai({ signal: propre.signal }, 10_000);
    expect(signal?.aborted).toBe(false);
    propre.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("les trois plafonds sont ceux de la mission, et ils sont ordonnés", () => {
    expect(DELAI_POSTGREST_MS).toBe(5_000);
    expect(DELAI_AUTH_MS).toBe(8_000);
    expect(DELAI_STORAGE_MS).toBe(15_000);
    // Un transfert d'octets a plus de marge qu'une requête sur un index.
    expect(DELAI_POSTGREST_MS).toBeLessThan(DELAI_AUTH_MS);
    expect(DELAI_AUTH_MS).toBeLessThan(DELAI_STORAGE_MS);
  });

  it("chaque appel sortant porte un signal — aucun n'est laissé sans plafond", async () => {
    await selectRows("deals", "select=id");
    await countRows("deals", "select=id");
    await sessionFromAccessToken(FRAIS);
    expect(fake.appels.length).toBeGreaterThanOrEqual(3);
    for (const appel of fake.appels) expect(appel.aSignal, appel.url).toBe(true);
  });

  it("un dépassement se reconnaît par son nom, et rien d'autre ne passe pour tel", () => {
    expect(estDelaiDepasse(timeoutError())).toBe(true);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(estDelaiDepasse(abort)).toBe(true);
    // Une vraie panne réseau n'est PAS un délai : elle a déjà son chemin.
    expect(estDelaiDepasse(new TypeError("fetch failed"))).toBe(false);
    expect(estDelaiDepasse(new SupabaseRequestError("non", 400, null))).toBe(false);
    expect(estDelaiDepasse("TimeoutError")).toBe(false);
    expect(estDelaiDepasse(null)).toBe(false);
  });
});

describe("B — LE PIÈGE : un délai dépassé n'est jamais un refus", () => {
  it("vérification du jeton : « unavailable », jamais « rejected »", async () => {
    fake.mode = "delai";
    const issue = await checkAccessToken(FRAIS);
    expect(issue.kind).toBe("unavailable");
    expect(issue.kind).not.toBe("rejected");
    expect(sessionState(issue)).toBe("indisponible");
  });

  it("rafraîchissement : « unavailable », jamais « rejected »", async () => {
    fake.mode = "delai";
    const issue = await refreshSessionOutcome("un-jeton-de-rafraichissement");
    expect(issue.kind).toBe("unavailable");
    expect(issue.kind).not.toBe("rejected");
  });

  it("la session d'une requête : « unavailable »", async () => {
    fake.mode = "delai";
    expect(await sessionFromAccessToken(FRAIS)).toEqual({ kind: "unavailable", status: null });
  });

  it("et par contraste, un VRAI refus reste un refus", async () => {
    fake.mode = "refus";
    expect((await checkAccessToken(FRAIS)).kind).toBe("rejected");
  });
});

describe("C — proxy.ts : AUCUN cookie de session n'est effacé sur un délai", () => {
  const demande = (chemin: string) =>
    proxy(new NextRequest(`http://localhost:3000${chemin}`, { headers: { cookie: `sb_access_token=${FRAIS}; sb_refresh_token=r1` } }));

  // Les en-têtes qui déconnectent : un cookie de session remis à Max-Age=0.
  const expirations = (response: Response) =>
    response.headers.getSetCookie().filter((c) => /^sb_(access|refresh)_token=;/.test(c) || /^sb_(access|refresh)_token=; .*Max-Age=0/.test(c));

  it("page de compte, délai dépassé : la session est intacte", async () => {
    fake.mode = "delai";
    const response = await demande("/compte");
    expect(expirations(response)).toEqual([]);
    // Et l'indicateur d'affichage n'est pas effacé non plus : il n'y a rien à
    // conclure sur la session.
    expect(response.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toEqual([]);
  });

  it("zone propriétaire, délai dépassé : refus d'entrer, mais rien n'est détruit", async () => {
    fake.mode = "delai";
    const response = await demande("/admin");
    expect(expirations(response)).toEqual([]);
  });

  it("LA DIFFÉRENCE, mesurée : un vrai refus efface, un délai n'efface pas", async () => {
    fake.mode = "refus";
    const refuse = await demande("/compte");
    expect(expirations(refuse).length).toBeGreaterThan(0);

    fake.appels = [];
    fake.mode = "delai";
    const retarde = await demande("/compte");
    expect(expirations(retarde)).toEqual([]);
  });
});

describe("D — côté service, un délai devient une indisponibilité nommée", () => {
  it("une lecture qui dépasse le délai lève un 504, pas une DOMException nue", async () => {
    fake.mode = "delai";
    await expect(selectRows("deals", "select=id")).rejects.toThrow(SupabaseRequestError);
    await expect(selectRows("deals", "select=id")).rejects.toMatchObject({ status: 504, code: "delai" });
  });

  it("le message nomme l'opération ET le plafond : un journal n'a rien à deviner", async () => {
    fake.mode = "delai";
    await expect(countRows("analyses", "select=id")).rejects.toThrow(/comptage analyses : délai de 5000 ms dépassé/);
  });

  it("504 veut dire « reviens plus tard » pour le partage déjà en place", async () => {
    const { statusMeansUnavailable } = await import("@/lib/auth/session-state");
    expect(statusMeansUnavailable(504)).toBe(true);
  });

  it("une erreur qui n'est pas un délai remonte telle quelle", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    await expect(selectRows("deals", "select=id")).rejects.toThrow(TypeError);
  });
});
