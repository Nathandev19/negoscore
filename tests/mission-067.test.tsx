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
      // Mission #158 — deuxième personne au neutre : « connecté » accordait au
      // masculin une phrase adressée à n'importe qui.
      "Ta session est bien ouverte. Mais cette analyse n'est pas rattachée à ton compte : elle a sans doute été faite sans compte, dans un autre navigateur, ou elle a été supprimée depuis.",
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

// Mission #183 — CE QUE LA #067 DISAIT, LE SOLDE LE DIT MAINTENANT.
//
// La ligne « Négociation gratuite : Encore disponible / Déjà utilisée » est
// retirée. Elle répondait à une question que « Négociations restantes » ne
// savait pas traiter : cette ligne-là affichait credits.balance, donc 0 pour
// un compte gratuit, qu'il lui reste sa gratuité ou non. Depuis la #182 elle
// porte le solde réel, et la question est répondue par le nombre.
//
// Ce bloc vérifie qu'AUCUN ÉTAT N'EST DEVENU MUET. C'est la seule raison pour
// laquelle la ligne peut partir.
describe("D — /compte dit toujours où en est la gratuité, par le solde", () => {
  const free = accountSummary({ plan: "free", balance: 0, period_end: null });
  const vue = (summary: ReturnType<typeof accountSummary>, restantes: number | null | "illisible") =>
    text(renderToStaticMarkup(<AccountView data={{ email: "n@e.test", summary, restantes }} />));

  it("la ligne de la #067 a bien disparu de l'écran", () => {
    for (const restantes of [0, 1] as const) {
      expect(vue(free, restantes)).not.toContain("Négociation gratuite");
    }
    expect(read("components/account/account-view.tsx")).not.toContain("FREE_ANALYSIS_LABEL");
  });

  it("gratuité encore disponible : le solde le dit", () => {
    expect(vue(free, 1)).toContain("1 négociation");
  });

  it("gratuité déjà prise, et aucune réserve : le solde le dit aussi", () => {
    // L'état que la ligne retirée couvrait. Il reste lisible : 0 et 1 ne
    // s'affichent pas pareil.
    const zero = vue(free, 0);
    expect(zero).toContain("0 négociation");
    expect(zero).not.toContain("1 négociation");
  });

  it("LE CAS CROISÉ — gratuité prise MAIS une réserve achetée : le nombre est celui de la réserve", () => {
    // C'est l'état que la ligne de la #067 ne savait pas montrer : elle ne
    // s'affichait que pour un compte gratuit, et ce compte-ci n'en est plus un.
    const pack = accountSummary({ plan: "pack", balance: 3, period_end: null });
    const html = vue(pack, 3);
    expect(html).toContain("3 négociations");
    expect(html).not.toContain("Négociation gratuite");
  });

  it("L'INVERSE — une réserve existe et la gratuité est intacte : un seul nombre, celui du moteur", () => {
    // Le solde ne cumule pas la gratuité avec une réserve achetée : un compte
    // qui a payé ne repasse pas par la gratuité (lib/billing/entitlement.ts).
    // La page affiche donc le nombre du moteur, sans l'additionner elle-même.
    const pack = accountSummary({ plan: "pack", balance: 2, period_end: null });
    const html = vue(pack, 2);
    expect(html).toContain("2 négociations");
    expect(html).not.toContain("3 négociations");
  });

  it("compte payant : rien ne manque, et aucune ligne de gratuité ne revient", () => {
    const payant = accountSummary({ plan: "pro", balance: 0, period_end: new Date(Date.now() + 86_400_000).toISOString() });
    const html = vue(payant, 28);
    expect(html).toContain("28 négociations");
    expect(html).not.toContain("gratuite");
  });

  it("lecture impossible : un tiret, et toujours pas de zéro inventé", () => {
    expect(vue(free, "illisible")).toContain("—");
    expect(vue(free, "illisible")).not.toContain("0 négociation");
  });

  it("le compteur de gratuité est toujours lu — il entre dans le solde", () => {
    // Mission #107 : il part dans la même vague que le reste. Ce qui change,
    // c'est qu'il n'est plus interprété par la page mais par le moteur.
    const source = read("app/compte/page.tsx");
    expect(source).toMatch(/accountFreeUsage\(user\.id\)/);
    expect(source).toContain("analysisBalanceFrom(user, credits ?? null, adminGrant, freeCounter)");
    // Et la page ne l'interprète plus elle-même.
    expect(source).not.toContain("accountFreeAnalysisUsedFrom");
  });
});
