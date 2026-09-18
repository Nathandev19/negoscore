import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NO_JS_MESSAGE } from "@/components/deal-input";
import { JS_FLAG_SCRIPT } from "@/lib/no-js";

// Mission #076, A4 — ce qu'une personne sans JavaScript LIT, page par page.
//
// Le HTML est lu comme un navigateur l'affiche, dans les deux façons dont un
// navigateur peut traiter <noscript> (spécification HTML, « scripting flag ») :
//   - scripts réellement désactivés : son contenu est du balisage ;
//   - scripts bloqués après coup (extension, politique de sécurité, vue web
//     d'application) : le navigateur a lu la page « avec scripts », et le
//     contenu de <noscript> n'est plus qu'une chaîne de caractères. S'il
//     s'affiche, ce sont les chevrons qu'on lit.
// Dans aucun des deux cas le texte affiché ne doit contenir une balise ou un
// attribut en toutes lettres.

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
// Rendu serveur hors de Next : le routeur n'est pas monté.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) =>
    code[0] === "#"
      ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
      : (ENTITIES[code] ?? all),
  );

// Texte affiché : balises retirées, entités décodées. scriptingFlag : le
// contenu de <noscript> est alors du texte brut, lu tel quel.
function displayedText(html: string, scriptingFlag: boolean): string {
  let body = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ");
  const raw: string[] = [];
  if (scriptingFlag) {
    body = body.replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi, (_all, inner: string) => {
      raw.push(decode(inner));
      return ` \u0000${raw.length - 1}\u0000 `;
    });
  }
  const text = decode(body.replace(/<[^>]+>/g, " "));
  return text.replace(/\u0000(\d+)\u0000/g, (_all, i: string) => raw[Number(i)]).replace(/\s+/g, " ");
}

const TAG_OR_ATTRIBUTE = /<\/?[a-z][^>]*>|\b(class|href|data-[a-z-]+|aria-[a-z]+)="/i;

function expectReadable(html: string) {
  for (const scriptingFlag of [false, true]) {
    const text = displayedText(html, scriptingFlag);
    expect(text.match(TAG_OR_ATTRIBUTE)?.[0] ?? null, `scripting flag : ${scriptingFlag}`).toBeNull();
  }
}

// Textes des éléments réservés à « sans JavaScript » : du vrai balisage.
function withoutJsTexts(html: string): string[] {
  return [...html.matchAll(/<(a|p)\b[^>]*\bdata-sans-js=""[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => decode(m[2]));
}

describe("sans JavaScript, le texte affiché ne contient aucun code", () => {
  it("le lecteur de test attrape bien le défaut (contrôle du test lui-même)", () => {
    expect(() => expectReadable('<noscript><p class="x">Bonjour</p></noscript>')).toThrow();
    expect(() => expectReadable("<p>Bonjour</p>")).not.toThrow();
  });

  it("en-tête (toutes les pages) : « Se connecter », ordinateur et mobile", async () => {
    const { SiteHeader } = await import("@/components/site-header");
    const html = renderToString(<SiteHeader />);
    expectReadable(html);
    expect(withoutJsTexts(html)).toEqual(["Se connecter", "Se connecter"]);
    expect(html.match(/<a data-sans-js="" href="\/connexion"/g)).toHaveLength(2);
  });

  it("accueil", async () => {
    const { default: HomePage } = await import("@/app/page");
    const html = renderToString(<HomePage />);
    expectReadable(html);
    expect(withoutJsTexts(html)).toContain(NO_JS_MESSAGE);
  });

  it("/analyse", async () => {
    const { default: AnalysePage } = await import("@/app/analyse/page");
    const html = renderToString(<AnalysePage />);
    expectReadable(html);
    expect(withoutJsTexts(html)).toContain(NO_JS_MESSAGE);
  });

  it("/tarifs", async () => {
    const { default: PlansPage } = await import("@/app/tarifs/page");
    const html = renderToString(<PlansPage />);
    expectReadable(html);
    expect(withoutJsTexts(html).filter((t) => t.startsWith("Le paiement demande JavaScript"))).toHaveLength(2);
    // L'attente des boutons, qui ne se résoudrait jamais, est masquée sans JavaScript.
    expect(html.match(/data-pending-purchase="true" data-avec-js=""/g)).toHaveLength(2);
  });

  it("/connexion", async () => {
    const { default: LoginPage } = await import("@/app/connexion/page");
    expectReadable(renderToString(await LoginPage()));
  });
});

describe("le mécanisme : pas de <noscript>, un attribut posé par le premier script", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("aucun <noscript> dans le code de l'application", () => {
    for (const file of ["components/header-nav.tsx", "components/offers/offers-list.tsx", "components/deal-input.tsx", "app/layout.tsx"]) {
      expect(read(file).replace(/\/\/.*|\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\//g, ""), file).not.toMatch(/<noscript/);
    }
  });

  it("la mise en page pose data-js dans <head>, et la feuille de style s'en sert", async () => {
    expect(read("app/layout.tsx")).toContain("<script dangerouslySetInnerHTML={{ __html: JS_FLAG_SCRIPT }} />");
    expect(JS_FLAG_SCRIPT).toBe('document.documentElement.setAttribute("data-js","")');
    const css = read("app/globals.css");
    expect(css).toMatch(/\[data-js\] \[data-sans-js\],\s*html:not\(\[data-js\]\) \[data-avec-js\] \{\s*display: none !important;/);
  });
});

describe("B2 — sans JavaScript, le formulaire d'analyse ne lance rien", () => {
  it("pas de bouton d'envoi, pas d'action, pas de champ nommé : rien ne peut partir, rien n'est consommé", async () => {
    const { DealInput } = await import("@/components/deal-input");
    const html = renderToString(<DealInput />);
    const form = html.match(/<form\b[^>]*>/)?.[0] ?? "";
    expect(form).not.toMatch(/\baction=|\bmethod=/);
    // Le seul bouton d'envoi n'existe qu'avec JavaScript.
    expect(html.match(/<button[^>]*type="submit"[^>]*>/g)).toEqual([expect.stringContaining('data-avec-js=""')]);
    // Le texte n'est jamais envoyé par le navigateur seul.
    expect(html).not.toMatch(/<textarea[^>]*\bname=/);
    // Le compteur, figé sans JavaScript, ne s'affiche pas.
    expect(html).toMatch(/<p data-avec-js="" id="[^"]+" class="text-right/);
  });
});
