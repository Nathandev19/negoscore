import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #103 — ce qui est réellement ÉCRIT. La fonction pure est vérifiée
// dans tests/environment.test.ts ; ici, on regarde la ligne qui part en base
// quand le navigateur, lui, prétend autre chose.

const db = vi.hoisted(() => ({ rows: [] as Array<{ table: string; row: Record<string, unknown> }> }));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  insertIfAbsent: async (table: string, row: Record<string, unknown>) => {
    db.rows.push({ table, row });
    return row;
  },
}));

const { POST, bodySchema } = await import("@/app/api/events/route");
const { SupabaseRequestError } = await import("@/lib/supabase/server");
const { withEnvironment } = await import("@/lib/telemetry/tagged");

// Le corps que le navigateur envoie, avec ce qu'il n'a pas le droit de décider.
function send(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("https://negoscore.fr/api/events", {
      method: "POST",
      // Mission #120 — User-Agent d'un vrai navigateur : sans lui, la route
      // classe la requête comme automatique et n'écrit aucune ligne.
      headers: {
        "Content-Type": "application/json",
        origin: "https://negoscore.fr",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
      body: JSON.stringify(body),
    }),
  );
}

const written = () => db.rows.at(-1)?.row ?? {};

beforeEach(() => {
  db.rows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("le client n'a aucune autorité sur l'environnement", () => {
  it("le corps annonce « production », le serveur résout « development » : la ligne vaut development", async () => {
    // Le serveur est un poste de développement : ni VITEST, ni VERCEL_ENV.
    vi.stubEnv("VITEST", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("NODE_ENV", "development");

    const response = await send({ event: "landing_view", environment: "production", attribution: { path: "/" } });
    expect(response.status).toBe(204);
    expect(written().environment).toBe("development");
  });

  it("le corps annonce « production » pendant un run de tests : la ligne vaut test", async () => {
    // VITEST est défini : c'est le cas réel de cette suite.
    expect(process.env.VITEST).toBeDefined();
    const response = await send({ event: "landing_view", environment: "production" });
    expect(response.status).toBe(204);
    expect(written().environment).toBe("test");
  });

  it("le serveur est en production : la ligne vaut production, quoi que dise le corps", async () => {
    vi.stubEnv("VITEST", undefined);
    vi.stubEnv("VERCEL_ENV", "production");

    await send({ event: "pricing_view", environment: "development" });
    expect(written().environment).toBe("production");
  });

  it("l'attribution est relue champ par champ : rien d'autre n'en ressort", async () => {
    const { parseAttribution } = await import("@/lib/analytics/first-party");
    const parsed = parseAttribution({
      path: "/",
      environment: "production",
      user_id: "00000000-0000-4000-8000-000000000000",
      event_name: "purchase_completed",
    });
    expect(Object.keys(parsed).sort()).toEqual(
      ["path", "referrer_host", "utm_campaign", "utm_content", "utm_medium", "utm_source"].sort(),
    );
  });

  it("le schéma retire les champs inattendus avant tout : ils n'existent plus après validation", () => {
    const parsed = bodySchema.parse({ event: "landing_view", environment: "production", user_id: "usurpé", metadata: { x: 1 } });
    expect(Object.keys(parsed).sort()).toEqual(["event"]);
    expect("environment" in parsed).toBe(false);
  });

  it("aucun champ du corps n'atteint l'insert en dehors de ceux du schéma", async () => {
    await send({
      event: "landing_view",
      environment: "production",
      user_id: "00000000-0000-4000-8000-000000000000",
      event_name: "purchase_completed",
      occurred_at: "1999-01-01T00:00:00.000Z",
      metadata: { injecte: true },
      dedupe_key: "cle-injectee-par-le-client",
      // Même chemin par l'attribution : elle est relue champ par champ, elle
      // n'est jamais étalée dans la ligne.
      attribution: { path: "/", environment: "production", event_name: "purchase_completed", injecte: true },
    });

    const row = written();
    expect(row.event_name).toBe("landing_view");
    expect(row.user_id).toBeNull();
    expect(row.metadata).toEqual({});
    expect(row.dedupe_key).toBeNull();
    expect(row.occurred_at).toBeUndefined();
    expect(row.injecte).toBeUndefined();
    // Les clés écrites sont exactement celles que le code construit.
    expect(Object.keys(row).sort()).toEqual(
      [
        "dedupe_key", "entity_id", "entity_type", "environment", "event_name", "internal", "metadata",
        "path", "referrer_host", "user_id", "utm_campaign", "utm_content", "utm_medium", "utm_source",
      ].sort(),
    );
  });

  it("un champ environment dans le corps ne change rien à la réponse : il est ignoré en silence", async () => {
    const avec = await send({ event: "landing_view", environment: "production" });
    const sans = await send({ event: "landing_view" });
    expect(avec.status).toBe(sans.status);
    expect(avec.status).toBe(204);
    // Rien dans la réponse ne dit au client que son champ a été vu.
    expect(await avec.text()).toBe(await sans.text());
  });
});

describe("le repli quand la colonne n'existe pas encore", () => {
  // Mission #118 — le repli est devenu PROGRESSIF : on ne renonce à
  // l'environnement que si c'est lui qui manque, et pas parce que la colonne
  // `internal` n'existe pas encore.
  it("colonne internal absente : la ligne repart avec l'environnement, sans la marque", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await withEnvironment(async (extra) => {
      calls.push(extra);
      if ("internal" in extra) throw new SupabaseRequestError("colonne absente", 400, "42703");
      return "écrit";
    });
    expect(result).toBe("écrit");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ environment: "test", internal: false });
    // L'environnement est CONSERVÉ : le cockpit ne perd pas ses lignes de
    // production pendant le temps qui sépare le déploiement de la migration.
    expect(calls[1]).toEqual({ environment: "test" });
  });

  it("colonne environment absente aussi : la ligne repart nue, une seule fois de plus", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await withEnvironment(async (extra) => {
      calls.push(extra);
      if ("environment" in extra || "internal" in extra) throw new SupabaseRequestError("colonne absente", 400, "42703");
      return "écrit";
    });
    expect(result).toBe("écrit");
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual({});
  });

  it("toute autre erreur remonte telle quelle : la ligne n'est pas réécrite", async () => {
    let attempts = 0;
    await expect(
      withEnvironment(async () => {
        attempts += 1;
        throw new SupabaseRequestError("doublon", 409, "23505");
      }),
    ).rejects.toThrow("doublon");
    // Une seule tentative : un insert non idempotent ne doit pas partir deux fois.
    expect(attempts).toBe(1);
  });
});

describe("le chemin d'écriture, dans le code", () => {
  it("aucun étalement du corps de la requête n'arrive jusqu'à l'insert", () => {
    const route = readFileSync("app/api/events/route.ts", "utf8");
    // La ligne est construite champ par champ ailleurs ; ici, seuls deux
    // champs validés sortent du corps.
    expect(route).not.toMatch(/\.\.\.\s*(body|parsed\.data|json)/);
    expect(route).toContain("bodySchema.safeParse");

    const writer = readFileSync("lib/analytics/first-party.ts", "utf8");
    expect(writer).not.toMatch(/\.\.\.\s*input\b/);
    expect(writer).toContain("withEnvironment");
  });

  it("toutes les tables comptées par /admin sont écrites avec leur environnement", () => {
    const files = [
      "lib/analytics/first-party.ts",
      "lib/analysis/feedback.ts",
      "app/api/analyse/route.ts",
      "app/api/upload-url/route.ts",
      "lib/billing/purchases.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/withEnvironment|currentEnvironment/);
      // Aucune valeur d'environnement en dur nulle part.
      expect(source, file).not.toMatch(/environment:\s*["'](production|preview|development|test|unknown)["']/);
    }
  });
});
