import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #209 — CE QUE LA ROUTE ACCEPTE, ET CE QU'ELLE REFUSE EN SILENCE.
//
// Le relevé de comportement vient du navigateur : tout y est donc suspect.
// Deux règles de la maison s'appliquent, et elles sont vérifiées ici :
//   - le client ne choisit pas une valeur, il choisit une ENTRÉE d'une table
//     fermée — la page mesurée comme chaque tranche ;
//   - la réponse ne change pas d'un octet selon ce qui a été fait de la
//     requête : un corps refusé et un corps accepté se répondent pareil.

const state = vi.hoisted(() => ({ ecrits: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/analytics/first-party", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/analytics/first-party")>();
  return {
    ...real,
    recordProductEvent: async (input: Record<string, unknown>) => {
      state.ecrits.push(input);
    },
  };
});

const { POST } = await import("@/app/api/events/route");

const ORIGIN = "https://www.negoscore.fr";

const RELEVE = {
  scroll: "51-75",
  dwell: "10-30s",
  first_action: "1-5s",
  input: "text",
  scrolled: true,
} as const;

function envoyer(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request(`${ORIGIN}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", "user-agent": "Mozilla/5.0 (iPhone)", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const corps = (patch: Record<string, unknown> = {}) => ({
  event: "page_engagement",
  engagement: RELEVE,
  attribution: { path: "/", utm_medium: "paid_social" },
  ...patch,
});

beforeEach(() => {
  state.ecrits = [];
});

describe("un relevé valide", () => {
  it("il est enregistré, avec ses tranches dans metadata", async () => {
    const r = await envoyer(corps());
    expect(r.status).toBe(204);
    expect(state.ecrits).toHaveLength(1);
    expect(state.ecrits[0]).toMatchObject({ event: "page_engagement", metadata: RELEVE });
  });

  it("LE CANAL D'ACQUISITION VOYAGE AVEC LUI : sans ça, le payant ne se distingue pas", async () => {
    await envoyer(corps());
    const attribution = state.ecrits[0].attribution as Record<string, unknown>;
    expect(attribution.utm_medium).toBe("paid_social");
    expect(attribution.path).toBe("/");
  });

  it("RIEN D'AUTRE QUE LE RELEVÉ N'ENTRE : une clé en plus fait refuser le corps", async () => {
    // Pas « retirer en silence » : le cockpit agrège ces clés, donc une clé
    // mal nommée serait un compteur muet et une clé en trop une catégorie
    // que personne ne verrait.
    const r = await envoyer(corps({ engagement: { ...RELEVE, texte: "Bonjour, on propose 300 €" } }));
    expect(r.status).toBe(400);
    expect(state.ecrits).toEqual([]);
  });
});

describe("ce qui est refusé", () => {
  it("UNE PAGE QUI N'EST PAS MESURÉE n'écrit rien, et la réponse ne le dit pas", async () => {
    const r = await envoyer(corps({ attribution: { path: "/tarifs" } }));
    expect(r.status).toBe(204);
    expect(state.ecrits).toEqual([]);
  });

  it("un chemin forgé n'invente pas de page", async () => {
    for (const path of ["/tiktok-promo", "/admin", "/", "/analyse"]) {
      state.ecrits = [];
      await envoyer(corps({ attribution: { path } }));
      // Seul l'accueil est instrumenté. /tiktok-promo n'est pas une page :
      // c'est une redirection vers l'accueil (lib/acquisition/chemins.ts).
      expect(state.ecrits.length, path).toBe(path === "/" ? 1 : 0);
    }
  });

  it("un relevé ABSENT n'écrit pas une ligne vide", async () => {
    const r = await envoyer({ event: "page_engagement", attribution: { path: "/" } });
    expect(r.status).toBe(204);
    expect(state.ecrits).toEqual([]);
  });

  it("une tranche inventée fait refuser le corps entier", async () => {
    for (const patch of [
      { scroll: "42" },
      { dwell: "3 min" },
      { first_action: "jamais" },
      { input: "message_de_la_marque" },
      { scrolled: "oui" },
    ]) {
      state.ecrits = [];
      const r = await envoyer(corps({ engagement: { ...RELEVE, ...patch } }));
      expect(r.status, JSON.stringify(patch)).toBe(400);
      expect(state.ecrits, JSON.stringify(patch)).toEqual([]);
    }
  });

  it("UN RELEVÉ QUI SE CONTREDIT est refusé : c'est un défaut de mesure", async () => {
    // « a défilé » avec « premier geste : aucun » ne décrit rien de réel : le
    // relevé lève les deux drapeaux au même endroit. Le compter donnerait un
    // chiffre faux dans l'outil même qui sert à ne plus supposer.
    const r = await envoyer(corps({ engagement: { ...RELEVE, first_action: "aucun" } }));
    expect(r.status).toBe(400);
    expect(state.ecrits).toEqual([]);
    // L'inverse, lui, est parfaitement possible : on peut cliquer le champ
    // sans avoir défilé.
    const r2 = await envoyer(corps({ engagement: { ...RELEVE, scrolled: false } }));
    expect(r2.status).toBe(204);
    expect(state.ecrits).toHaveLength(1);
  });

  it("un robot qui se nomme n'écrit rien", async () => {
    const r = await envoyer(corps(), { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    expect(r.status).toBe(204);
    expect(state.ecrits).toEqual([]);
  });

  it("le refus de suivi est respecté, côté serveur", async () => {
    for (const entete of [{ dnt: "1" }, { "sec-gpc": "1" }] as Array<Record<string, string>>) {
      state.ecrits = [];
      const r = await envoyer(corps(), entete);
      expect(r.status).toBe(204);
      expect(state.ecrits).toEqual([]);
    }
  });

  it("une requête d'une autre origine est refusée", async () => {
    const r = await POST(
      new Request(`${ORIGIN}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "https://ailleurs.example", "user-agent": "Mozilla/5.0" },
        body: JSON.stringify(corps()),
      }),
    );
    expect(r.status).toBe(403);
    expect(state.ecrits).toEqual([]);
  });
});

describe("les autres événements ne gagnent rien au passage", () => {
  it("AUCUN AUTRE ÉVÉNEMENT NE PEUT DÉPOSER DE MÉTADONNÉES par cette route", async () => {
    await envoyer({ event: "landing_view", engagement: RELEVE, attribution: { path: "/" } });
    expect(state.ecrits).toHaveLength(1);
    expect(state.ecrits[0].metadata).toBeUndefined();
  });

  it("et la vue d'accueil continue de partir normalement", async () => {
    await envoyer({ event: "landing_view", attribution: { path: "/" } });
    expect(state.ecrits).toHaveLength(1);
    expect(state.ecrits[0]).toMatchObject({ event: "landing_view" });
  });
});
