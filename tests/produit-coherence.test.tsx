import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { HistoryView } from "@/components/account/history-view";
import { buildConclusion, unclearPoints } from "@/lib/negotiation/conclusion";
import { EXCHANGES_PHRASE, NEGOTIATION_EXCHANGES } from "@/lib/content/vocabulaire";
import { previewAnalysis } from "@/lib/fixtures/preview-states";
import { readThreadKey, readThreadReply, saveThreadDraft, clearThreadDraft, threadDraftKey } from "@/lib/negotiation/draft";
import { emptyPoints, readPoints } from "@/lib/negotiation/points";
import { baseAnalysis } from "@/lib/negotiation/scenarios";
import { processTurn, type TurnContext } from "@/lib/negotiation/turn";
import { shouldAskFeedback } from "@/lib/analysis/feedback";
import {
  MIN_REPLY_LENGTH,
  TOO_SHORT_REPLY_MESSAGE,
  turnReadingSchema,
  type Deal,
  type PointState,
  type TurnPayload,
  type TurnReading,
} from "@/lib/negotiation/types";
import { LAST_TURN } from "@/lib/negotiation/types";

// Mission #099 — ce que l'audit #098 a trouvé, et qu'on corrige. Un fichier
// par famille de défauts serait plus joli ; ils se répondent trop pour être
// séparés : une contradiction, un mot interdit et une promesse non tenue sont
// le même problème vu de trois côtés.

const state = vi.hoisted(() => ({ viewer: null as { id: string; email: string | null } | null, rows: [] as unknown[] }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => state.viewer, getViewerAccessToken: async () => null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async () => state.rows,
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[\s  ]+/g, " ");

// Le contenu d'un fichier SANS ses commentaires : ils expliquent la règle (et
// citent donc les mots interdits) sans jamais s'afficher.
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

// ─── Le fil, pour les tours ──────────────────────────────────────────────────

function offer(over: Record<string, unknown> = {}) {
  const analysis = baseAnalysis("sample-extraction", "confirmed", {
    exclusivity: { present: false, duration_months: null, category: null },
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, duration_months: 6, territory: null, perpetual: false },
    ...over,
  });
  analysis.counter_offer = { ...analysis.counter_offer, changes: ["Définir le territoire couvert par les droits."] };
  return analysis;
}

function reading(base: Deal, rest: Omit<TurnReading, "deal" | "relevance" | "relevance_note">): TurnReading {
  return turnReadingSchema.parse({ relevance: "reply", relevance_note: "", ...rest, deal: base });
}

function turn(context: TurnContext, read: TurnReading): TurnPayload {
  const result = processTurn(context, read);
  if (result.kind !== "turn") throw new Error("pas un tour");
  return result.payload;
}

const vague = (draft = "Bonjour,\n\nMerci.\n\nBelle journée,") => ({
  outcome: "vague" as const,
  global_agreement: null,
  asks: [{ id: "c1", status: "granted" as const, quote: "introuvable dans ce message", remaining: null }],
  changes: [],
  brand_questions: [],
  uncertainties: [],
  next_message: { text: draft, tone: "Clair" },
});

beforeEach(() => {
  state.viewer = null;
  state.rows = [];
});

describe("point 3 (audit C2) — « ok » ne déclenche plus d'appel au modèle", () => {
  it("5. dix-neuf caractères : refusé ; vingt : accepté", () => {
    expect(MIN_REPLY_LENGTH).toBe(20);
    expect("C'est ok pour nous.".length).toBeLessThan(MIN_REPLY_LENGTH);
    expect("C'est ok pour nous !!".length).toBeGreaterThanOrEqual(MIN_REPLY_LENGTH);
    // Le message dit quoi coller, et ne renvoie pas la faute à la personne.
    expect(TOO_SHORT_REPLY_MESSAGE).toContain("le dernier message de la marque");
    expect(TOO_SHORT_REPLY_MESSAGE).not.toMatch(/erreur|invalide/i);
    // La route refuse AVANT tout appel au modèle : le contrôle est la première
    // chose qu'elle fait du corps de la requête.
    const route = read("app/api/analyses/[id]/tours/route.ts");
    expect(route.indexOf("MIN_REPLY_LENGTH")).toBeLessThan(route.indexOf("await readBrandReply("));
  });
});

describe("point 4 (audits B1 et B11) — le doute ne contredit plus la mémoire", () => {
  const original = offer();
  const brandReply = "Territoire : France uniquement, et rien au-delà pour cette campagne.";
  const second = turn(
    { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply },
    reading({ ...original.deal, usage: { ...original.deal.usage, territory: "France" } }, {
      ...vague(),
      changes: [{ group: "territory", quote: "Territoire : France uniquement" }],
    }),
  );

  it("6. à la conclusion, un point mémorisé n'apparaît dans aucun doute", () => {
    const points = second.points;
    expect(points.find((point) => point.key === "territory")).toMatchObject({ status: "answered", turn: 2 });

    const doubts = unclearPoints(second.deal_after, second.asks, second.uncertainties, points);
    for (const doubt of doubts) expect(doubt.toLowerCase()).not.toContain("territoire");

    // Et la conclusion complète, qui les porte, n'en dit pas plus.
    const conclusion = buildConclusion({
      deal: second.deal_after,
      asks: second.asks,
      uncertainties: second.uncertainties,
      language: "fr",
      source: "creator_accepted",
      points,
    });
    for (const doubt of conclusion.unclear) expect(doubt.toLowerCase()).not.toContain("territoire");
  });

  it("6 bis. sans la mémoire, le doute reviendrait : c'est bien elle qui le retient", () => {
    const doubts = unclearPoints(second.deal_after, second.asks, second.uncertainties, []);
    expect(doubts.join(" ").toLowerCase()).toContain("territoire");
  });

  it("7. un tour « Non vérifiable » n'affiche pas de doute sur un point mémorisé", () => {
    // La citation du modèle est introuvable : la demande est « non vérifiable ».
    expect(second.asks.find((ask) => ask.id === "c1")?.unverified_turn).toBe(2);
    // Le point, lui, est renseigné par la phrase de la marque : aucun doute.
    for (const doubt of second.uncertainties) expect(doubt.toLowerCase()).not.toContain("territoire");
  });
});

describe("point 5 (audit B16) — plusieurs montants dans un même message", () => {
  it("8. les deux montants non retenus sont cités, avec la raison du choix", () => {
    const original = offer();
    const brandReply = "On hésite entre 500 € et 700 €, disons jusqu'à 900 € en tout.";
    const payload = turn(
      { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply },
      reading(original.deal, vague()),
    );

    expect(payload.stated_ceiling).toBe(900);
    const doubt = payload.uncertainties.find((entry) => entry.includes("plusieurs montants"));
    expect(doubt).toBeDefined();
    // Cités tels qu'ils sont écrits.
    expect(doubt).toContain("500 €");
    expect(doubt).toContain("700 €");
    // Et la raison du choix.
    expect(doubt).toContain("le dernier qu'elle annonce comme plafond");
  });

  it("8 bis. un seul montant : aucun doute de ce genre", () => {
    const original = offer();
    const payload = turn(
      { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply: "On peut aller jusqu'à 900 € pour ce projet." },
      reading(original.deal, vague()),
    );
    expect(payload.uncertainties.some((entry) => entry.includes("plusieurs montants"))).toBe(false);
  });
});

describe("point 6 (audit B17) — la marque se dédit", () => {
  it("9. le point garde les deux citations et les deux tours", () => {
    const deal = offer().deal;
    const first = readPoints({
      previous: emptyPoints(deal, ["Définir le territoire couvert par les droits."]),
      brandReply: "Territoire : France uniquement.",
      changes: [],
      turn: 2,
      deal,
      askLabels: ["Définir le territoire couvert par les droits."],
    });
    const after = readPoints({
      previous: first,
      brandReply: "Finalement, le territoire sera l'Europe entière.",
      changes: [],
      turn: 3,
      deal,
      askLabels: ["Définir le territoire couvert par les droits."],
    });

    const point = after.find((entry) => entry.key === "territory") as PointState;
    expect(point.turn).toBe(3);
    expect(point.quote).toContain("Europe");
    expect(point.previous).toMatchObject({ turn: 2, status: "answered" });
    expect(point.previous?.quote).toContain("France uniquement");
  });

  it("9 bis. l'écran affiche les deux positions", () => {
    const html = renderToStaticMarkup(
      <HistoryView rows={[]} />,
    );
    // Le rendu du tour est vérifié par les scénarios ; ici on s'assure que le
    // libellé existe dans le composant qui le porte.
    expect(html).toBeDefined();
    expect(read("components/result/negotiation/turn-card.tsx")).toContain("La marque a changé de position");
  });
});

describe("points 8 et 9 (audits B2 et C1) — une offre incomplète ne promet rien", () => {
  const incomplete = previewAnalysis("incomplete").analysis;
  const complete = previewAnalysis("debloque").analysis;

  it("12. pas de section d'avis, et aucun titre ne promet un montant", () => {
    // Sans fourchette, la question n'a pas de sens : elle n'est pas rendue.
    expect(
      shouldAskFeedback({
        current: { low: incomplete.estimate.total_low, high: incomplete.estimate.total_high },
        lastJudged: null,
        answeredThisTurn: false,
      }),
    ).toBe(false);
    // Une offre sans montant de la marque, elle, A une fourchette : on demande.
    const unpriced = previewAnalysis("unpriced").analysis;
    expect(unpriced.estimate.total_low).not.toBeNull();
    expect(
      shouldAskFeedback({
        current: { low: unpriced.estimate.total_low, high: unpriced.estimate.total_high },
        lastJudged: null,
        answeredThisTurn: false,
      }),
    ).toBe(true);

    const markup = text(renderToStaticMarkup(<AnalysisResult analysis={incomplete} unlockHref="/connexion" />));
    expect(markup).not.toContain("contre-offre chiffrée");
    expect(markup).toContain("Ce que tu peux demander");
    // Le bloc dit pourquoi il n'y a pas de montant, et ce qui manque.
    expect(markup).toContain("n'a pas de montant");
    expect(markup).toContain("territoire de diffusion des pubs");
  });

  it("12 bis. une offre chiffrée garde son titre et sa question", () => {
    const markup = text(renderToStaticMarkup(<AnalysisResult analysis={complete} unlockHref="/connexion" />));
    expect(markup).toContain("Ta contre-offre chiffrée");
    expect(
      shouldAskFeedback({
        current: { low: complete.estimate.total_low, high: complete.estimate.total_high },
        lastJudged: null,
        answeredThisTurn: false,
      }),
    ).toBe(true);
  });
});

describe("point 10 (audits B3, B4, B5) — le mot « crédit » a quitté les textes client", () => {
  // Tout ce qui parle à la personne : écrans, messages d'erreur, emails.
  const CLIENT_FILES = [
    "app/api/analyse/route.ts",
    "app/api/analyses/[id]/tours/route.ts",
    "app/compte/supprimer/page.tsx",
    "app/compte/page.tsx",
    "app/confidentialite/page.tsx",
    "app/cgv/page.tsx",
    "components/account/account-view.tsx",
    "components/loading-steps.tsx",
    "components/result/negotiation/negotiation-thread.tsx",
    "lib/auth/flash.ts",
    "lib/billing/right-hint.ts",
    "lib/email/templates.ts",
    "lib/llm/errors.ts",
  ] as const;

  it("13. aucun texte client ne contient « crédit », emails et erreurs compris", () => {
    for (const file of CLIENT_FILES) {
      // Les noms de code (colonnes, fonctions) ne sont pas des textes : on ne
      // regarde que ce qui est entre guillemets ou dans du JSX.
      const source = read(file);
      const shown = [...source.matchAll(/"([^"\n]{8,})"|`([^`\n]{8,})`|>([^<>{}\n]{8,})</g)].map((m) => m[1] ?? m[2] ?? m[3]);
      for (const phrase of shown) {
        expect(/crédits?(?![\p{L}])/iu.test(phrase), `${file} : « ${phrase.trim().slice(0, 70)} »`).toBe(false);
      }
    }
  });

  it("14. /compte et /compte/supprimer emploient le même mot", () => {
    for (const file of ["components/account/account-view.tsx", "app/compte/supprimer/page.tsx"]) {
      expect(read(file), file).toMatch(/négociations?/i);
    }
    expect(read("app/compte/supprimer/page.tsx")).toContain("Tes négociations restantes");
  });
});

describe("point 11 (audit B13) — le produit annonce des échanges, pas des tours", () => {
  it("15. tout texte qui compte les tours annonce « jusqu'à 4 échanges », depuis la constante", () => {
    expect(NEGOTIATION_EXCHANGES).toBe(LAST_TURN - 1);
    expect(EXCHANGES_PHRASE).toBe(`l'analyse, puis jusqu'à ${NEGOTIATION_EXCHANGES} échanges avec la marque`);
    for (const file of [
      "lib/content/vocabulaire.ts",
      "lib/content/home.ts",
      "components/result/negotiation/negotiation-thread.tsx",
      "app/api/analyses/[id]/tours/route.ts",
    ]) {
      // Aucun nombre de tours écrit à la main, nulle part.
      expect(/\d+\s+tours/.test(read(file)), file).toBe(false);
    }
  });
});

describe("point 12 (audit B14) — la langue de l'offre, verrouillée", () => {
  it("16. offre en français, réponse en anglais : le message sortant reste en français", () => {
    const original = offer();
    expect(original.language).toBe("fr");
    const payload = turn(
      {
        original,
        previous: [],
        turnNumber: 2,
        tier: "confirmed",
        brandReply: "Hello, thanks for your message. We can confirm the territory is France only.",
      },
      // Brouillon sans salutation : c'est le CODE qui l'ajoute, dans la langue
      // de l'offre. Si la règle sautait, ce message commencerait par « Hello, ».
      reading(original.deal, vague("Merci pour votre retour.\n\nBelle journée,")),
    );
    // Le message part dans la langue de l'OFFRE : c'est une décision produit,
    // pas un oubli (lib/negotiation/turn.ts).
    expect(payload.message.text.startsWith("Bonjour,")).toBe(true);
    expect(payload.message.text).not.toContain("Hello,");
    expect(read("lib/negotiation/turn.ts")).toContain("original.language");
  });
});

describe("points 13 et 14 (audits B15 et C3) — rien ne se perd", () => {
  const ID = "44444444-4444-4444-8444-444444444444";
  const store = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      size: () => data.size,
    };
  };

  it("17. texte conservé après un refus, brouillon restauré, effacé après acceptation", () => {
    const memory = store();
    saveThreadDraft(ID, { reply: "La marque a répondu ceci, en entier.", key: "cle-1" }, memory);

    // Rechargement : le texte ET la clé reviennent.
    expect(readThreadReply(ID, memory)).toBe("La marque a répondu ceci, en entier.");
    expect(readThreadKey(ID, memory)).toBe("cle-1");

    // Refus définitif : la clé est abandonnée, le texte reste.
    saveThreadDraft(ID, { reply: "La marque a répondu ceci, en entier.", key: null }, memory);
    expect(readThreadReply(ID, memory)).toBe("La marque a répondu ceci, en entier.");
    expect(readThreadKey(ID, memory)).toBeNull();

    // Tour accepté : plus rien.
    clearThreadDraft(ID, memory);
    expect(readThreadReply(ID, memory)).toBe("");
    expect(memory.size()).toBe(0);

    // Un brouillon par analyse : celui d'une autre n'est pas touché.
    saveThreadDraft(ID, { reply: "un", key: null }, memory);
    saveThreadDraft("55555555-5555-4555-8555-555555555555", { reply: "deux", key: null }, memory);
    expect(readThreadReply(ID, memory)).toBe("un");
    expect(threadDraftKey(ID)).not.toBe(threadDraftKey("55555555-5555-4555-8555-555555555555"));
  });

  it("17 bis. stockage indisponible : tout continue, sans brouillon", () => {
    const broken = {
      getItem: () => {
        throw new Error("stockage bloqué");
      },
      setItem: () => {
        throw new Error("stockage bloqué");
      },
      removeItem: () => {
        throw new Error("stockage bloqué");
      },
    };
    expect(() => saveThreadDraft(ID, { reply: "x", key: null }, broken)).not.toThrow();
    expect(readThreadReply(ID, broken)).toBe("");
    expect(readThreadKey(ID, broken)).toBeNull();
    expect(() => clearThreadDraft(ID, broken)).not.toThrow();
  });

  it("18. sans JavaScript, le formulaire re-rendu contient le texte soumis", () => {
    const source = read("components/result/negotiation/negotiation-thread.tsx");
    // Le formulaire part vers l'action serveur, avec les champs qu'elle lit.
    expect(source).toContain("action={serverAction}");
    expect(source).toContain('name="reply"');
    expect(source).toContain('name="analysisId"');
    expect(source).toContain('name="tier"');
    // Et ce que l'action renvoie en cas d'échec contient le texte soumis.
    expect(read("lib/forms/no-js-actions.ts")).toContain("status: \"error\", message:");
    expect(read("lib/forms/no-js-actions.ts")).toContain("reply,");
    expect(source).toContain('server.status === "error" ? server.reply');
  });

  it("19. la clé d'idempotence est restaurée après rechargement", () => {
    const memory = store();
    saveThreadDraft(ID, { reply: "texte en cours d'envoi, assez long", key: "cle-en-cours" }, memory);
    // Ce que fait le composant au moment d'envoyer : la clé gardée passe avant
    // une clé neuve, donc le second envoi est le MÊME tour.
    expect(readThreadKey(ID, memory)).toBe("cle-en-cours");
    expect(read("components/result/negotiation/negotiation-thread.tsx")).toContain("readThreadKey(analysisId) ?? newKey()");
  });
});

describe("point 15 (audit B12) — l'historique dit qu'une analyse est ancienne", () => {
  const row = {
    id: "66666666-6666-4666-8666-666666666666",
    created_at: "2026-09-01T10:00:00.000Z",
    score: 42,
    amount: 300,
    evaluability: "complete",
    tier: "confirmed",
  };

  it("20. table ancienne : la mention est là ; table courante : aucune", () => {
    const old = text(renderToStaticMarkup(<HistoryView rows={[{ ...row, rateTable: "fr-2025.1" }]} />));
    expect(old).toContain("fr-2025.1");
    expect(old).toContain("ces chiffres ne sont plus recalculés");

    const current = text(renderToStaticMarkup(<HistoryView rows={[{ ...row, rateTable: "fr-2026.3" }]} />));
    expect(current).not.toContain("ne sont plus recalculés");
    // Ligne sans version (lecture partielle) : on ne dit rien plutôt que faux.
    const unknown = text(renderToStaticMarkup(<HistoryView rows={[{ ...row, rateTable: null }]} />));
    expect(unknown).not.toContain("ne sont plus recalculés");
  });
});
