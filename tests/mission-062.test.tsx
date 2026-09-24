import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { composeAnalysis } from "@/lib/analysis/compose";
import { lockAnalysis } from "@/lib/analysis/lock";
import { MAX_TEXT_LENGTH, MAX_TEXT_LENGTH_LABEL, TEXT_TRUNCATED_NOTE } from "@/lib/analysis/text";
import { PLANS } from "@/lib/billing/plans";
import { clearDraft, DRAFT_KEY, DRAFT_TTL_MS, draftExpiresIn, pruneDraft, saveDraft } from "@/lib/draft";
import { baseExtraction } from "@/lib/fixtures/preview-states";
import { validateAnnouncedFile } from "@/lib/storage/documents";

// Mission #062 — accessibilité, abus, textes, défauts d'usage, journaux.
// Chaque test porte sur un point corrigé, nommé par son numéro de mission.

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const sources = globSync("{app,components,lib}/**/*.{ts,tsx}", { cwd: root }).map((file) => file.replace(/\\/g, "/"));

// Fichiers qui rendent une page entière : ils portent le point de repère
// principal, donc la cible du lien d'évitement.
const withMain = sources.filter((file) => /<main\b/.test(read(file)));

describe("A4 — lien d'évitement", () => {
  it("la mise en page pose le lien, avant tout le reste du corps", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('href="#contenu"');
    expect(layout).toContain("Aller au contenu");
    // Placé avant la bannière et le contenu : c'est le premier élément focusable.
    expect(layout.indexOf('href="#contenu"')).toBeLessThan(layout.indexOf("<FlashBanner"));
  });

  it("chaque <main> du site porte l'ancre visée", () => {
    expect(withMain.length).toBeGreaterThan(15);
    const sans = withMain.filter((file) => !/<main id="contenu"/.test(read(file)));
    expect(sans).toEqual([]);
  });
});

describe("A11 — le menu mobile ne piège plus le focus", () => {
  it("aucun déroutement de Tab dans l'en-tête, et Échap ferme toujours", () => {
    const nav = read("components/header-nav.tsx");
    expect(nav).not.toMatch(/event\.key !== "Tab"|shiftKey/);
    expect(nav).toContain('event.key === "Escape"');
    // Le menu se referme quand le focus le quitte : c'est ce qui remplace le piège.
    expect(nav).toContain("onMenuBlur");
  });
});

describe("A12 — un bouton occupé ou indisponible reste au clavier", () => {
  const files = [
    "app/connexion/login-form.tsx",
    "components/deal-input.tsx",
    "components/result/estimate-feedback.tsx",
    "components/result/retry-panel.tsx",
    "components/offers/plan-checkout-form.tsx",
  ];

  it("aucun de ces formulaires ne retire son bouton de l'ordre de tabulation", () => {
    const offenders = files.filter((file) => /\sdisabled=\{/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("tous annoncent l'état par aria-disabled", () => {
    const offenders = files.filter((file) => !read(file).includes("aria-disabled="));
    expect(offenders).toEqual([]);
  });
});

describe("B1 et B2 — limites des routes publiques", () => {
  it("le dépôt de fichier et la lecture du droit passent par le compteur existant", () => {
    for (const file of ["app/api/upload-url/route.ts", "app/api/droits/route.ts"]) {
      expect(read(file), file).toContain("hitUsageGuard");
      expect(read(file), file).toContain("@/lib/security/limits");
    }
  });

  it("aucun second compteur : les deux routes appellent la fonction SQL existante", () => {
    for (const file of ["app/api/upload-url/route.ts", "app/api/droits/route.ts"]) {
      expect(read(file), file).toContain("@/lib/security/usage-guard");
    }
    expect(read("lib/security/usage-guard.ts")).toContain("usage_guard_hit");
  });
});

describe("B3 — le refus de /api/credits n'est pas mis en cache", () => {
  it("sans session, 401 et Cache-Control no-store", async () => {
    const { GET } = await import("@/app/api/credits/route");
    const response = await GET(new Request("http://localhost:3000/api/credits"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("C2 — les formules ne se distinguent que par le nombre de négociations", () => {
  it("les trois annoncent la même négociation complète", () => {
    const premieres = PLANS.map((plan) => plan.features[0]);
    expect(new Set(premieres).size).toBe(1);
    // Mission #093 : l'unité vendue est la négociation, et les trois formules
    // en donnent exactement le même contenu.
    expect(premieres[0]).toContain("Le deal en entier");
  });

  it("aucune formule payante ne laisse croire que la gratuite est amputée", () => {
    const payantes = PLANS.filter((plan) => plan.id !== "free");
    for (const plan of payantes) {
      for (const feature of plan.features) {
        expect(feature, plan.id).not.toMatch(/à chaque crédit|à chaque fois|inclus$/);
      }
    }
  });

  it("la formule gratuite dit la seule étape en plus : l'email", () => {
    const free = PLANS.find((plan) => plan.id === "free");
    expect(free?.features.join(" ")).toContain("email");
  });
});

describe("D1 — la limite de 60 000 caractères est annoncée", () => {
  it("le formulaire l'affiche, et le serveur applique la même valeur", () => {
    expect(MAX_TEXT_LENGTH).toBe(60_000);
    expect(TEXT_TRUNCATED_NOTE).toContain(MAX_TEXT_LENGTH_LABEL);
    const form = read("components/deal-input.tsx");
    expect(form).toContain("MAX_TEXT_LENGTH_LABEL");
    expect(form).toContain("seul le début sera analysé");
    // Une seule source : la route ne réécrit plus le chiffre.
    expect(read("app/api/analyse/route.ts")).toContain('from "@/lib/analysis/text"');
  });

  it("l'avertissement de texte tronqué reste visible sur une offre incomplète", () => {
    const extraction = baseExtraction();
    const analysis = composeAnalysis(
      { ...extraction, deal: { ...extraction.deal, deliverables: [], payment: { ...extraction.deal.payment, amount_eur: null } } },
      { extraAssumptions: [TEXT_TRUNCATED_NOTE] },
    );
    expect(analysis.evaluability).toBe("incomplete");
    const html = renderToStaticMarkup(<AnalysisResult analysis={lockAnalysis(analysis)} unlockHref="/connexion" />);
    expect(html).toContain("Hypothèses");
    expect(html).toContain("seul le début a été analysé");
  });
});

describe("D2 — le brouillon expire vraiment", () => {
  function store() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      size: () => data.size,
    };
  }

  it("pruneDraft efface un brouillon de plus de 24 h sans qu'on le relise", () => {
    const s = store();
    saveDraft("offre collée", s, 1_000);
    expect(s.size()).toBe(1);
    pruneDraft(s, 1_000 + DRAFT_TTL_MS + 1);
    expect(s.getItem(DRAFT_KEY)).toBeNull();
  });

  it("pruneDraft garde un brouillon encore valable", () => {
    const s = store();
    saveDraft("offre collée", s, 1_000);
    pruneDraft(s, 1_000 + DRAFT_TTL_MS - 1);
    expect(s.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("draftExpiresIn donne le temps restant, et null sans brouillon", () => {
    const s = store();
    expect(draftExpiresIn(s, 0)).toBeNull();
    saveDraft("offre collée", s, 1_000);
    expect(draftExpiresIn(s, 1_000)).toBe(DRAFT_TTL_MS);
    expect(draftExpiresIn(s, 1_000 + DRAFT_TTL_MS + 5)).toBe(0);
    clearDraft(s);
    expect(draftExpiresIn(s, 1_000)).toBeNull();
  });

  it("la déconnexion efface le brouillon de ce navigateur", () => {
    const banner = read("components/flash-banner.tsx");
    expect(banner).toContain("clearDraft");
    expect(banner).toContain('flash.kind === "deconnexion"');
  });
});

describe("D4 — le refus d'un fichier dit sa cause", () => {
  const base = { kind: "pdf", mime: "application/pdf" };

  it("un fichier vide est nommé comme tel", () => {
    const result = validateAnnouncedFile({ ...base, bytes: 0 });
    expect(result).toEqual({ error: "Ce fichier est vide : il ne contient aucune donnée. Choisis un autre fichier." });
  });

  it("une taille absente ou aberrante dit que c'est la taille qui n'est pas arrivée", () => {
    for (const bytes of [undefined, "12", 1.5, -3]) {
      const result = validateAnnouncedFile({ ...base, bytes });
      expect(result).toEqual({
        error: "La taille du fichier n'a pas été transmise. Recharge la page et choisis le fichier à nouveau.",
      });
    }
  });

  it("plus aucun message ne parle de taille « illisible »", () => {
    expect(read("lib/storage/documents.ts")).not.toContain("Taille du fichier illisible");
  });
});

describe("E1 — les emails ne laissent pas de contenu dans les journaux", () => {
  const errors: string[] = [];
  const logs: string[] = [];

  beforeEach(() => {
    errors.length = 0;
    logs.length = 0;
    vi.stubEnv("RESEND_API_KEY", "re_cle_de_test");
    vi.stubEnv("EMAIL_FROM", "contact@exemple.test");
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const email = {
    to: "destinataire@exemple.test",
    subject: "Proposition de collaboration confidentielle",
    text: "corps du message",
  };

  it("un envoi réussi ne journalise ni l'objet ni le destinataire", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "sent_1" })));
    const { sendEmail } = await import("@/lib/email/send");
    const outcome = await sendEmail(email, { kind: "inbound_forward" });
    expect(outcome.sent).toBe(true);
    expect(logs.join(" ")).not.toContain("Proposition de collaboration");
    expect(logs.join(" ")).not.toContain("destinataire@exemple.test");
    expect(logs.join(" ")).toContain("inbound_forward");
  });

  it("un refus de Resend ne recopie pas son corps de réponse", async () => {
    const corps = JSON.stringify({
      message: "Invalid `reply_to` field: marque-privee@exemple.test",
      name: "validation_error",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(corps, { status: 422 })));
    const { sendEmail } = await import("@/lib/email/send");
    const outcome = await sendEmail(email, { kind: "inbound_forward" });
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toBe("HTTP 422");
    expect(errors.join(" ")).not.toContain("marque-privee@exemple.test");
    expect(errors.join(" ")).not.toContain("validation_error");
  });
});

describe("E2 — entrées brutes tenues hors des journaux et des filtres", () => {
  it("/auth/confirm ne journalise pas la valeur de type fournie par le visiteur", () => {
    const route = read("app/auth/confirm/route.ts");
    expect(route).toContain("type_length");
    expect(route).not.toMatch(/reason: tokenHash \? "type_refuse" : "token_hash_absent", type \}/);
  });

  it("le webhook Whop contrôle la forme avant de poser une valeur dans un filtre", () => {
    const events = read("lib/billing/whop-events.ts");
    expect(events).toContain("isUuid(fromMetadata)");
    // Mission #112 — l'email n'entre plus dans aucun filtre : il ne sert plus à
    // attribuer un paiement. Le seul autre identifiant posé dans un filtre est
    // celui de l'abonnement, gabarité de la même façon.
    expect(events).toContain("MEMBERSHIP_ID.test(membershipId)");
    expect(events).not.toContain("email=ilike.");
  });
});
