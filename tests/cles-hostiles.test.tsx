import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #113, C — une clé venue de l'adresse ne doit rien pouvoir obtenir
// d'une table qui ne la contient pas.
//
// Mesuré avant la correction, sur le serveur de développement :
//   /tarifs?erreur=__proto__ → « Cette page n'a pas pu s'afficher »
//   (Objects are not valid as a React child), sur la page qui vend.

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  viewer: { id: "u1", email: "nina@exemple.test" } as { id: string; email: string } | null,
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => state.params,
}));
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => state.viewer,
  getViewerState: async () => ({ state: state.viewer ? "valide" : "absente", user: state.viewer }),
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async () => [{ plan: "free", balance: 0, period_end: null, cancelled_at: null }],
}));

const { OffersError } = await import("@/components/offers/offers-error");
const { default: CancelPage } = await import("@/app/resilier/page");

const HOSTILE = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"];

beforeEach(() => {
  state.params = new URLSearchParams();
  state.viewer = { id: "u1", email: "nina@exemple.test" };
});

const tarifs = (erreur: string | null) => {
  state.params = new URLSearchParams(erreur === null ? "" : `erreur=${encodeURIComponent(erreur)}`);
  return renderToStaticMarkup(<OffersError />);
};

describe("/tarifs — le bandeau d'erreur d'achat", () => {
  it("une clé hostile ne rend rien, et ne fait rien planter", () => {
    for (const key of HOSTILE) expect(tarifs(key), key).toBe("");
  });

  it("une clé inconnue ne rend rien non plus", () => {
    expect(tarifs("nimportequoi")).toBe("");
    expect(tarifs(null)).toBe("");
  });

  it("les clés légitimes affichent toujours leur message", () => {
    expect(tarifs("consentement")).toContain("Coche la case");
    expect(tarifs("formule")).toContain("Cette formule n&#x27;existe pas.");
    expect(tarifs("indisponible")).toContain("Le paiement n&#x27;est pas disponible");
    expect(tarifs("deja_pro")).toContain("déjà en cours");
    expect(tarifs("session")).toContain("Rien n&#x27;a été débité");
  });
});

describe("/resilier — la même table, côté serveur", () => {
  const render = async (erreur: string | undefined) =>
    renderToStaticMarkup(
      await CancelPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve(erreur === undefined ? {} : { erreur }),
      }),
    );

  it("une clé hostile ne fait pas planter la page, et n'affiche aucune erreur", async () => {
    for (const key of HOSTILE) {
      const html = await render(key);
      expect(html, key).toContain("Résilier");
      expect(html, key).not.toContain("object Object");
    }
  });

  it("les clés légitimes affichent toujours leur message", async () => {
    expect(await render("introuvable")).toContain("On n&#x27;a pas retrouvé ton abonnement");
    expect(await render("whop")).toContain("La résiliation n&#x27;a pas pu être enregistrée");
    expect(await render("indisponible")).toContain("Le service de résiliation n&#x27;est pas disponible");
  });
});
