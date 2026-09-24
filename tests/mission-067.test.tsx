import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountView } from "@/components/account/account-view";
import { ReadyMessage, CounterOffer } from "@/components/result/unlocked-blocks";
import { accountSummary } from "@/lib/account/summary";
import { composeAnalysis } from "@/lib/analysis/compose";
import { nextFromEmailLink } from "@/lib/auth/sign-in";
import { baseExtraction } from "@/lib/fixtures/preview-states";

// Mission #067, parties B, C et D.

const viewer = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));
// Mission #089 bis — les pages lisent l'ÉTAT (trois issues), plus seulement
// l'utilisateur : connecté → « valide », null → « absente ».
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => viewer.current,
  getViewerState: async () => ({ state: viewer.current ? "valide" : "absente", user: viewer.current }),
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll(" ", " ")
    .replace(/\s+/g, " ");

const analysis = composeAnalysis(baseExtraction());

describe("B — atterrir sur le message débloqué", () => {
  it("le bouton « Débloquer » ramène sur #message", () => {
    expect(read("app/analyse/resultat/[id]/page.tsx")).toContain("#message`)}`");
  });

  it("le message porte l'ancre, décalée sous l'en-tête collant, et son titre peut prendre le focus", () => {
    const html = renderToStaticMarkup(<ReadyMessage message={analysis.ready_to_send_message} />);
    expect(html).toMatch(/<section id="message" class="[^"]*scroll-mt-24/);
    expect(html).toMatch(/<h2 tabindex="-1"/);
  });

  it("l'ancre survit au lien email, que Supabase encode l'adresse de retour ou non", () => {
    const site = "https://www.negoscore.fr";
    const inner = encodeURIComponent("/analyse/resultat/abc#message");
    // Inséré tel quel : une fois décodé par /auth/confirm, le « # » devient l'ancre de l'adresse de retour.
    expect(nextFromEmailLink(`${site}/auth/callback?next=/analyse/resultat/abc#message`, site)).toBe("/analyse/resultat/abc#message");
    expect(nextFromEmailLink(`${site}/auth/callback?next=${inner}`, site)).toBe("/analyse/resultat/abc#message");
    expect(nextFromEmailLink("/analyse/resultat/abc#message", site)).toBe("/analyse/resultat/abc#message");
  });

  it("le déplacement respecte prefers-reduced-motion : saut direct, sans animation", () => {
    const source = read("components/result/analysis-result.tsx");
    expect(source).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(source).toContain('behavior: reduce ? "auto" : "smooth"');
  });
});

describe("B3 — signal « Débloqué à l'instant », une fois, sans animation", () => {
  it("présent sur les deux blocs à l'arrivée", () => {
    for (const html of [
      renderToStaticMarkup(<ReadyMessage message={analysis.ready_to_send_message} justUnlocked />),
      renderToStaticMarkup(<CounterOffer offer={analysis.counter_offer} justUnlocked />),
    ]) {
      expect(text(html)).toContain("Débloqué à l'instant");
      // La pastille elle-même : ni animation, ni transition, ni pulsation.
      const badge = html.match(/<span[^>]*>Débloqué à l(?:&#x27;|')instant<\/span>/)?.[0] ?? "";
      expect(badge).not.toBe("");
      expect(badge).not.toMatch(/animate-|transition|skeleton/);
    }
  });

  it("absent en temps normal", () => {
    expect(text(renderToStaticMarkup(<ReadyMessage message={analysis.ready_to_send_message} />))).not.toContain("Débloqué");
    expect(text(renderToStaticMarkup(<CounterOffer offer={analysis.counter_offer} />))).not.toContain("Débloqué");
  });

  it("un rechargement ne le rejoue pas : l'ancre est retirée de l'adresse", () => {
    expect(read("components/result/analysis-result.tsx")).toContain(
      "window.history.replaceState(window.history.state, \"\", window.location.pathname + window.location.search);",
    );
  });
});

describe("C — plus de « débloquée » au-dessus d'une page introuvable", () => {
  it("connecté, analyse inaccessible : ce qui s'est passé et quoi faire", async () => {
    viewer.current = { id: "u", email: "nina@exemple.test" };
    const { default: ResultNotFound } = await import("@/app/analyse/resultat/not-found");
    const html = renderToStaticMarkup(await ResultNotFound());
    expect(text(html)).toContain("Cette analyse n'est pas sur ton compte");
    expect(text(html)).toContain(
      "Tu es bien connecté. Mais cette analyse n'est pas rattachée à ton compte : elle a sans doute été faite sans compte, dans un autre navigateur, ou elle a été supprimée depuis.",
    );
    expect(text(html)).toContain(
      "Pour la retrouver, retourne dans le navigateur où tu l'as lancée et clique à nouveau sur « Débloquer ». Elle sera rattachée à ton compte, même si tu ouvres ensuite le lien reçu par email ailleurs.",
    );
    expect(html).toContain('href="/historique"');
    expect(text(html)).not.toContain("débloquée");
  });

  it("sans session : la 404 habituelle, qui ne dit pas si l'analyse existe", async () => {
    viewer.current = null;
    const { default: ResultNotFound } = await import("@/app/analyse/resultat/not-found");
    const html = text(renderToStaticMarkup(await ResultNotFound()));
    expect(html).toContain("Page introuvable");
    expect(html).toContain("Cette page n'existe pas, ou tu n'y as pas accès depuis ce navigateur.");
  });
});

describe("D — /compte dit où en est l'analyse gratuite", () => {
  const free = accountSummary({ plan: "free", balance: 0, period_end: null });

  it("encore disponible", () => {
    const html = text(renderToStaticMarkup(<AccountView data={{ email: "n@e.test", summary: free, freeAnalysis: "available" }} />));
    expect(html).toContain("Négociation gratuite Encore disponible");
  });

  it("déjà utilisée", () => {
    const html = text(renderToStaticMarkup(<AccountView data={{ email: "n@e.test", summary: free, freeAnalysis: "used" }} />));
    expect(html).toContain("Négociation gratuite Déjà utilisée");
  });

  it("formule payante ou lecture impossible : la ligne n'apparaît pas", () => {
    const html = text(renderToStaticMarkup(<AccountView data={{ email: "n@e.test", summary: free, freeAnalysis: null }} />));
    expect(html).not.toContain("Analyse gratuite");
  });

  it("la ligne n'est affichée que pour un compte gratuit", () => {
    // Mission #107 — la lecture part EN MÊME TEMPS que le solde, au lieu de
    // l'attendre : elle ne dépendait pas de lui, seul son affichage en dépend.
    // Ce qui compte pour la personne est inchangé : un compte payant ne voit
    // pas cette ligne.
    const source = read("app/compte/page.tsx");
    // Mission #107 — le compteur se lit avec le solde ; c'est son
    // interprétation, et le repli qui la complète, qui restent réservés au
    // compte gratuit.
    expect(source).toMatch(/summary\.plan === "free"\s*\?\s*await accountFreeAnalysisUsedFrom/);
    expect(source).toMatch(/accountFreeUsage\(user\.id\)/);
    const payant = accountSummary({ plan: "pro", balance: 0, period_end: new Date(Date.now() + 86_400_000).toISOString() });
    const rendu = text(renderToStaticMarkup(<AccountView data={{ email: "n@e.test", summary: payant, freeAnalysis: null }} />));
    expect(rendu).not.toContain("Analyse gratuite");
  });
});
