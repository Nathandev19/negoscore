import { authTemplates } from "@/lib/email/auth-templates";
import { accountDeletionEmail, cancellationConfirmationEmail, purchaseConfirmationEmail } from "@/lib/email/templates";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.ts, voir next.config.ts) : chaque
// email rendu tel qu'envoyé, pour le regarder dans le navigateur. Aucun envoi.
// /dev/emails?nom=achat-pack|achat-pro|resiliation|suppression|connexion|inscription
// &inversion=1 : approximation d'une messagerie qui inverse les couleurs d'office
// (Gmail en sombre), par filtre CSS. Ce n'est PAS le rendu exact de Gmail.
// Mode sombre déclaré (Apple Mail) : émuler prefers-color-scheme: dark.

const SITE = "http://localhost:3000";

// Valeurs d'exemple à la place des variables Supabase, pour l'aperçu seulement.
function fillSupabaseVariables(html: string): string {
  return html
    .replaceAll("{{ .SiteURL }}", SITE)
    .replaceAll("{{ .TokenHash }}", "pkce_exemple0123456789abcdef")
    .replaceAll("{{ .RedirectTo }}", `${SITE}/analyse/resultat/00000000-0000-4000-8000-000000000000`)
    .replaceAll("{{ .Email }}", "camille@exemple.fr");
}

function emails(): Record<string, string> {
  const [magic, signup] = authTemplates();
  const date = new Date("2026-09-17T10:00:00Z");
  return {
    "achat-pack": purchaseConfirmationEmail({ to: "x@exemple.fr", plan: "pack", amount: 4.99, currency: "eur", date, siteUrl: SITE }).html!,
    "achat-pro": purchaseConfirmationEmail({ to: "x@exemple.fr", plan: "pro", amount: 12.99, currency: "eur", date, siteUrl: SITE }).html!,
    resiliation: cancellationConfirmationEmail({ to: "x@exemple.fr", endsAt: new Date("2026-10-17T10:00:00Z"), siteUrl: SITE }).html!,
    suppression: accountDeletionEmail({ to: "x@exemple.fr", siteUrl: SITE }).html!,
    connexion: fillSupabaseVariables(magic.html),
    inscription: fillSupabaseVariables(signup.html),
  };
}

const INVERSION = `<style>html { filter: invert(1) hue-rotate(180deg); } img { filter: invert(1) hue-rotate(180deg); }</style>`;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const all = emails();
  const name = params.get("nom");
  const html = name ? all[name] : undefined;
  if (!html) {
    const links = Object.keys(all)
      .map((key) => `<li><a href="?nom=${key}">${key}</a> · <a href="?nom=${key}&inversion=1">inversé</a></li>`)
      .join("");
    return new Response(`<!doctype html><meta charset="utf-8"><ul>${links}</ul>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const body = params.get("inversion") === "1" ? html.replace("</head>", `${INVERSION}</head>`) : html;
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
