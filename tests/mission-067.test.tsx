import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountView } from "@/components/account/account-view";
import { ReadyMessage, CounterOffer } from "@/components/result/unlocked-blocks";
import { accountSummary } from "@/lib/account/summary";
import { SOLDE_EPUISE, negociationsCount, soldeBadge, soldeTexte } from "@/lib/content/labels";
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
  // Mission #184 — la vue reçoit le solde entier : le zéro a besoin de la
  // date de recharge pour dire ce qui se passe ensuite.
  const vue = (summary: ReturnType<typeof accountSummary>, restantes: number | null | "illisible", rechargeLe: Date | null = null) =>
    text(
      renderToStaticMarkup(
        <AccountView
          data={{ email: "n@e.test", summary, solde: restantes === "illisible" ? "illisible" : { restantes, rechargeLe, intact: false } }}
        />,
      ),
    );

  it("la ligne de la #067 a bien disparu de l'écran", () => {
    for (const restantes of [0, 1] as const) {
      expect(vue(free, restantes)).not.toContain("Négociation gratuite");
    }
    expect(read("components/account/account-view.tsx")).not.toContain("FREE_ANALYSIS_LABEL");
  });

  it("gratuité encore disponible : le solde le dit", () => {
    expect(vue(free, 1)).toContain("1 négociation");
  });

  it("gratuité déjà prise, et aucune réserve : le solde le dit, SANS zéro sec", () => {
    // L'état que la ligne retirée couvrait. Il reste lisible : 0 et 1 ne
    // s'affichent pas pareil.
    //
    // Mission #184 — et il ne s'affiche plus en nombre. La règle de la #182
    // vaut sur toute surface de solde : zéro dit ce qui se passe ENSUITE.
    const zero = vue(free, 0);
    expect(zero).not.toContain("0 négociation");
    expect(zero).not.toContain("1 négociation");
    expect(zero).toContain("Plus de négociation");
    // Et la suite : par où en obtenir d'autres, puisque rien ne se recharge.
    expect(zero).toContain("Les tarifs disent comment en avoir d'autres.");
  });

  it("zéro avec un quota qui se recharge : la phrase dit QUAND", () => {
    const pro = accountSummary({ plan: "pro", balance: 0, period_end: new Date("2026-11-03T00:00:00Z").toISOString() });
    const zero = vue(pro, 0, new Date("2026-11-03T00:00:00Z"));
    expect(zero).toContain("Plus de négociation");
    expect(zero).toContain("3 novembre");
    expect(zero).not.toContain("0 négociation");
  });

  it("la phrase n'apparaît QUE quand il ne reste rien : un solde confortable reste muet", () => {
    for (const restantes of [1, 3, 28] as const) {
      const html = vue(free, restantes);
      expect(html, String(restantes)).not.toContain("Plus de négociation");
      expect(html, String(restantes)).not.toContain("Les tarifs disent");
    }
  });

  it("la phrase et la valeur courte viennent des libellés de la #182, pas d'un texte neuf", () => {
    // Aucun libellé réécrit : soldeTexte et soldeBadge existaient déjà.
    const source = read("components/account/account-view.tsx");
    expect(source).toContain("soldeTexte(");
    expect(source).toContain("soldeTon(");
    // Et la phrase est RIGOUREUSEMENT celle de l'en-tête et de l'écran de saisie.
    expect(vue(free, 0)).toContain(soldeTexte(0, null));
    const quand = new Date("2026-11-03T00:00:00Z");
    expect(vue(free, 0, quand)).toContain(soldeTexte(0, quand));
  });

  it("aucun texte n'est tronqué : la phrase est en pleine largeur, sous la liste", () => {
    const html = renderToStaticMarkup(
      <AccountView data={{ email: "n@e.test", summary: free, solde: { restantes: 0, rechargeLe: null, intact: false } }} />,
    );
    // La phrase n'est pas dans la colonne des valeurs (<dd>), qui est large de
    // quelques caractères : elle est après la liste.
    const finDeListe = html.indexOf("</dl>");
    expect(finDeListe).toBeGreaterThan(0);
    expect(html.indexOf("data-solde-suite")).toBeGreaterThan(finDeListe);
    // Et la case de valeur garde une valeur courte — la MÊME que celle de
    // l'en-tête, pas une copie du texte : SOLDE_EPUISE est lu par les deux.
    expect(html).toContain(`data-restantes="true" class="text-right text-sm font-medium text-encre">${SOLDE_EPUISE}<`);
    expect(soldeBadge(0)).toBe(SOLDE_EPUISE);
    expect(read("components/account/account-view.tsx")).not.toContain('"Plus de négociation"');
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
    // Ni la phrase de zéro : on ne sait pas qu'il n'en reste plus.
    expect(vue(free, "illisible")).not.toContain("Plus de négociation");
  });

  it("la page transmet le solde ENTIER, date de recharge comprise", () => {
    // Relevé par la batterie : la page pouvait passer { ...solde,
    // rechargeLe: null } sans qu'aucun test tombe, et la phrase de zéro
    // perdait son « ton quota se recharge le … » en silence.
    const source = read("app/compte/page.tsx");
    expect(source).toContain('solde: solde ?? "illisible"');
    // Rien ne reconstruit l'objet en route : pas de champ réécrit.
    expect(source).not.toMatch(/solde:\s*solde\s*\?\s*\{/);
  });

  it("le libellé du solde épuisé ne se confond pas avec celui d'un historique vide", () => {
    // Deux faits différents, deux phrases différentes : « plus aucune
    // négociation DISPONIBLE » n'est pas « aucune négociation FAITE »
    // (le compteur de la #181 sur /historique). Si les deux se mettaient à
    // commencer par « Aucune négociation », les deux écrans deviendraient
    // illisibles ensemble.
    expect(SOLDE_EPUISE).toBe("Plus de négociation");
    expect(SOLDE_EPUISE).not.toMatch(/^Aucune/);
    expect(negociationsCount(0)).toMatch(/^Aucune/);
    // Et jamais un chiffre nu, sur aucune des deux surfaces.
    expect(SOLDE_EPUISE).not.toMatch(/\d/);
    expect(soldeTexte(0, null)).not.toMatch(/^0\b/);
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
