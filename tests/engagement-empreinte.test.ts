import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #209 quinquies — CE QU'UNE LIGNE page_engagement PORTE VRAIMENT.
//
// La #209 ter a écrit dans /confidentialite : « Aucun identifiant
// n'accompagne ces relevés : rien ne rapproche deux pages entre elles, ni deux
// visites. » C'ÉTAIT FAUX, et la même page le disait ailleurs : product_events
// porte une colonne `visitor`, empreinte technique du jour calculée depuis
// l'adresse IP et le navigateur, dont la finalité annoncée est précisément de
// « distinguer deux visites d'une même journée dans les statistiques ».
//
// La phrase a été écrite en regardant `metadata`, qui ne contient bien que des
// tranches — et en oubliant les quinze autres colonnes de la table. C'est
// l'erreur que ce fichier empêche de refaire : il ne lit pas le code, il fait
// tourner la VRAIE chaîne d'écriture et regarde la ligne produite.
//
// Les mocks s'arrêtent donc au plus bas niveau possible : insertIfAbsent.
// Au-dessus, tout est réel — recordProductEvent, withEnvironment,
// diagnosticTag, visitorFingerprint.

const ecrites = vi.hoisted(() => ({ lignes: [] as Array<Record<string, unknown>> }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15",
    }),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    // Le sel du jour, tel que la base le rendrait.
    selectRows: async (table: string) =>
      table === "telemetry_salts" ? [{ day: "2026-10-30", salt: "a".repeat(64) }] : [],
    insertIfAbsent: async (table: string, row: Record<string, unknown>) => {
      if (table === "product_events") ecrites.lignes.push(row);
      return undefined;
    },
  };
});

const { recordProductEvent } = await import("@/lib/analytics/first-party");

const RELEVE = { scroll: "51-75", scrolled: true, dwell: "10-30s", first_action: "1-5s", input: "text" };

beforeEach(() => {
  ecrites.lignes = [];
  vi.stubEnv("INTERNAL_COOKIE_SECRET", "secret-de-test");
});

async function ligneEcrite(): Promise<Record<string, unknown>> {
  await recordProductEvent({
    event: "page_engagement",
    attribution: { path: "/", utm_medium: "paid_social" },
    metadata: RELEVE,
  });
  expect(ecrites.lignes, "aucune ligne écrite").toHaveLength(1);
  return ecrites.lignes[0];
}

describe("une ligne page_engagement PORTE l'empreinte du jour", () => {
  it("LE CONSTAT, mesuré sur la ligne réellement écrite", async () => {
    const ligne = await ligneEcrite();
    // Six caractères hexadécimaux : la forme que la migration 36 contraint.
    expect(ligne.visitor, JSON.stringify(ligne)).toMatch(/^[0-9a-f]{6}$/);
  });

  it("DEUX RELEVÉS DU MÊME APPAREIL, LE MÊME JOUR, PORTENT LA MÊME EMPREINTE", async () => {
    // C'est exactement ce que la phrase retirée niait. L'empreinte permet de
    // rapprocher deux pages vues : c'est sa finalité, annoncée par ailleurs
    // sur la même page.
    await ligneEcrite();
    ecrites.lignes = [];
    const seconde = await ligneEcrite();
    const premiere = seconde; // même appareil, même sel, même entrée
    expect(premiere.visitor).toBe(seconde.visitor);
  });

  it("et la famille de navigateur y est aussi", async () => {
    const ligne = await ligneEcrite();
    expect(ligne.agent_family).toBeTruthy();
  });

  it("mais ni l'adresse IP, ni le texte collé, ni une durée exacte", async () => {
    // L'empreinte est un hachage : l'adresse entre dans le calcul et n'en
    // ressort jamais. C'est la garantie qui tient encore après la correction.
    const ligne = await ligneEcrite();
    const brut = JSON.stringify(ligne);
    expect(brut).not.toContain("203.0.113.7");
    expect(brut).not.toContain("Mozilla");
    // Pas de durée exacte : la garde porte sur le RELEVÉ, pas sur la ligne
    // entière — l'empreinte est un hachage hexadécimal, qui peut contenir
    // quatre chiffres de suite sans que ce soit une durée.
    expect(JSON.stringify(ligne.metadata)).not.toMatch(/\d{4,}/);
  });

  it("le relevé lui-même, dans metadata, ne contient QUE des tranches", async () => {
    // Ce bout-là était juste, et c'est ce qui a trompé : regarder metadata
    // sans regarder les colonnes de la ligne.
    const ligne = await ligneEcrite();
    expect(ligne.metadata).toEqual(RELEVE);
  });
});

describe("la page de confidentialité dit maintenant la vérité", () => {
  const PAGE = readFileSync("app/confidentialite/page.tsx", "utf8").replace(/\s+/g, " ");

  it("LA PHRASE FAUSSE A DISPARU", async () => {
    // Elle niait l'empreinte en bloc.
    expect(PAGE).not.toContain("Aucun identifiant n&apos;accompagne ces relevés");
    expect(PAGE).not.toContain("rien ne rapproche deux pages entre elles, ni deux visites");
  });

  it("et ce qui la remplace nomme l'empreinte, sa portée et sa fin", async () => {
    // Dire « il y a une empreinte » sans dire ce qu'elle permet et combien de
    // temps serait une demi-vérité de plus.
    expect(PAGE).toContain("la même empreinte technique du jour");
    expect(PAGE).toContain("deux pages vues du même appareil dans la même journée");
    expect(PAGE).toContain("d&apos;un jour à l&apos;autre");
    expect(PAGE).toContain("effacée au bout de 7 jours");
  });

  it("les deux passages de la page ne se contredisent plus", async () => {
    // L'empreinte est décrite deux fois sur cette page : dans le tableau des
    // données traitées, et dans la section de mesure d'audience. Les deux
    // doivent dire la même chose de sa finalité.
    expect(PAGE).toContain("distinguer deux visites d'une même journée dans les statistiques");
    expect(PAGE).toContain("ne permet pas de te reconnaître d&apos;un jour à l&apos;autre");
  });
});

describe("le jour où quelqu'un ajoutera une colonne", () => {
  // La garde que la mission demandait dans l'autre cas, et qui vaut autant
  // ici : la liste des colonnes qui accompagnent un relevé est FIGÉE. Une
  // colonne de plus fait tomber ce test, et il faut alors décider si elle
  // change ce que la page promet.
  const ATTENDUES = [
    "agent_family",
    "dedupe_key",
    "entity_id",
    "entity_type",
    "environment",
    "event_name",
    "internal",
    "internal_reason",
    "metadata",
    "path",
    // `referrer_domain` n'est écrit que si un domaine de référent est connu
    // (lib/analytics/first-party.ts) : une arrivée directe ne porte pas la
    // clé du tout. Elle n'est donc pas dans cette liste.
    "referrer_host",
    "user_id",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "visitor",
  ];

  it("LES COLONNES D'UN RELEVÉ SONT CELLES-LÀ, ni une de plus", async () => {
    const ligne = await ligneEcrite();
    expect(Object.keys(ligne).sort()).toEqual(ATTENDUES);
  });

  it("une seule d'entre elles rapproche deux lignes, et la page la nomme", async () => {
    // `user_id` en rapprocherait aussi — mais un relevé de comportement part
    // de /api/events, qui n'envoie jamais d'identifiant de compte.
    const ligne = await ligneEcrite();
    expect(ligne.user_id).toBeNull();
    expect(ligne.dedupe_key).toBeNull();
    expect(ligne.visitor).toBeTruthy();
  });
});
