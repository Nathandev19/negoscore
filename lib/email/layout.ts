import { BRAND } from "@/lib/brand";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { SELLER } from "@/lib/legal/identity";

// Gabarit HTML commun des emails (mission #044) : l'identité du site traduite
// dans ce que les messageries rendent vraiment.
//
// Contraintes, vérifiées par tests/email-html.test.ts :
//   - mise en page en <table> uniquement, jamais de <div> : Outlook 2016-2021
//     (Windows) rend le HTML avec le moteur de Word, sans flex ni grid ;
//   - styles en ligne ; une seule feuille <style> dans <head>, pour le mode
//     sombre et le mobile, que les clients qui l'ignorent (Gmail) n'utilisent
//     pas : le rendu ne dépend jamais d'elle ;
//   - 600 px de large, moins de 102 Ko (au-delà, Gmail tronque le message) ;
//   - aucune police personnalisée : Gmail et Outlook ne chargent pas de police
//     web. Titres en Arial Black (le plus proche honnête de Bricolage 800),
//     texte en Helvetica / Arial ;
//   - pas d'image de fond, pas de grain : aplats par bgcolor ;
//   - une seule image, le signe et le mot, avec un texte alternatif : si elle
//     est bloquée, le bandeau reste bleu avec « Negoscore » en texte, et
//     l'email se comprend entièrement sans elle ;
//   - mode sombre : voir HEAD_STYLE plus bas.

// Couleurs du site (lib/design/static-palette.ts, copie de globals.css).
export const EMAIL_COLORS = {
  marque: STATIC_PALETTE.marque,
  creme: STATIC_PALETTE.creme,
  encre: STATIC_PALETTE.encre,
  attenue: STATIC_PALETTE.attenue,
  filet: STATIC_PALETTE.filet,
  // Mode sombre
  nuit: STATIC_PALETTE.encre,
  nuitFilet: STATIC_PALETTE.encreDouce,
  nuitAttenue: STATIC_PALETTE.emailDark.attenue,
  nuitLien: STATIC_PALETTE.emailDark.lien,
} as const;

export const EMAIL_WIDTH = 600;
export const EMAIL_LOGO = { path: "/brand/negoscore-email-logo.png", width: 200, height: 40 } as const;

const HEADING_FONT = "'Arial Black', Arial, Helvetica, sans-serif";
const BODY_FONT = "Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Valeur d'attribut href : échappée, SAUF les variables de gabarit Supabase
// ({{ .SiteURL }}…) et les « & » de leurs paramètres, laissés tels que la
// documentation Supabase les écrit (voir lib/email/auth-templates.ts).
function href(url: string, raw: boolean): string {
  return raw ? url : escapeHtml(url);
}

// Mode sombre, choix de la mission #044 : le bandeau et le bouton bleus avec
// texte crème restent tels quels (ils survivent à l'inversion) ; le corps crème
// et encre passe en nuit et crème, déclaré explicitement.
//   - Apple Mail, iOS, Outlook macOS : prefers-color-scheme ci-dessous ;
//   - Outlook.com et applications Outlook : attributs data-ogsc / data-ogsb ;
//   - Gmail (web et applications) ignore ces règles et applique sa propre
//     inversion : voir le rapport de la mission #044.
const HEAD_STYLE = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .ns-page, .ns-card { background-color: ${EMAIL_COLORS.nuit} !important; }
  .ns-text { color: ${EMAIL_COLORS.creme} !important; }
  .ns-muted { color: ${EMAIL_COLORS.nuitAttenue} !important; }
  .ns-rule { border-color: ${EMAIL_COLORS.nuitFilet} !important; }
  .ns-link { color: ${EMAIL_COLORS.nuitLien} !important; }
}
[data-ogsb] .ns-page, [data-ogsb] .ns-card { background-color: ${EMAIL_COLORS.nuit} !important; }
[data-ogsc] .ns-text { color: ${EMAIL_COLORS.creme} !important; }
[data-ogsc] .ns-muted { color: ${EMAIL_COLORS.nuitAttenue} !important; }
[data-ogsc] .ns-link { color: ${EMAIL_COLORS.nuitLien} !important; }
@media only screen and (max-width: 620px) {
  .ns-container { width: 100% !important; }
  .ns-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .ns-title { font-size: 24px !important; }
}
`.trim();

export type EmailBlock =
  | { kind: "paragraph"; text: string; strong?: boolean }
  | { kind: "facts"; rows: Array<{ label: string; value: string }> }
  | { kind: "button"; label: string; url: string }
  | { kind: "small"; text: string }
  | { kind: "link"; label: string; url: string }
  | { kind: "heading"; text: string };

export type EmailLayout = {
  // Titre de l'onglet et objet de l'email.
  subject: string;
  // Aperçu affiché après l'objet dans la liste des messages.
  preheader: string;
  title: string;
  blocks: EmailBlock[];
  // URL publique du site ({{ .SiteURL }} pour un gabarit Supabase).
  siteUrl: string;
  // true : gabarit Supabase, les URL contiennent des variables à ne pas échapper.
  templateUrls?: boolean;
};

function paragraph(text: string, strong = false): string {
  return `<p class="ns-text" style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:24px;color:${EMAIL_COLORS.encre};${strong ? "font-weight:bold;" : ""}">${escapeHtml(text)}</p>`;
}

function facts(rows: Array<{ label: string; value: string }>): string {
  const cells = rows
    .map(
      (row) =>
        `<tr><td class="ns-muted ns-rule" style="padding:10px 0;border-bottom:1px solid ${EMAIL_COLORS.filet};font-family:${BODY_FONT};font-size:14px;line-height:20px;color:${EMAIL_COLORS.attenue};">${escapeHtml(row.label)}</td><td class="ns-text ns-rule" align="right" style="padding:10px 0;border-bottom:1px solid ${EMAIL_COLORS.filet};font-family:${BODY_FONT};font-size:14px;line-height:20px;font-weight:bold;color:${EMAIL_COLORS.encre};">${escapeHtml(row.value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ns-rule" style="margin:0 0 24px;border-top:1px solid ${EMAIL_COLORS.filet};">${cells}</table>`;
}

// Bouton : une cellule bleue, pas un lien stylé seul. Le lien complet est
// répété en texte dessous, pour les clients qui n'affichent pas le bouton.
function button(label: string, url: string, raw: boolean): string {
  const target = href(url, raw);
  const fallback = url.startsWith("mailto:")
    ? `<p class="ns-muted" style="margin:0 0 24px;font-family:${BODY_FONT};font-size:13px;line-height:19px;color:${EMAIL_COLORS.attenue};">Ou écris directement à <a class="ns-link" href="${target}" style="color:${EMAIL_COLORS.marque};">${escapeHtml(url.slice("mailto:".length))}</a></p>`
    : `<p class="ns-muted" style="margin:0 0 24px;font-family:${BODY_FONT};font-size:13px;line-height:19px;color:${EMAIL_COLORS.attenue};">Si le bouton ne s&#39;affiche pas, copie ce lien dans ton navigateur :<br><a class="ns-link" href="${target}" target="_blank" style="color:${EMAIL_COLORS.marque};word-break:break-all;">${raw ? url : escapeHtml(url)}</a></p>`;
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;"><tr>`,
    `<td bgcolor="${EMAIL_COLORS.marque}" style="background-color:${EMAIL_COLORS.marque};border-radius:6px;">`,
    `<a href="${target}" target="_blank" style="display:inline-block;padding:14px 24px;font-family:${BODY_FONT};font-size:16px;line-height:20px;font-weight:bold;color:${EMAIL_COLORS.creme};text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>`,
    `</td></tr></table>`,
    fallback,
  ].join("");
}

function small(text: string): string {
  return `<p class="ns-muted" style="margin:0 0 16px;font-family:${BODY_FONT};font-size:13px;line-height:19px;color:${EMAIL_COLORS.attenue};">${escapeHtml(text)}</p>`;
}

function heading(text: string): string {
  return `<p class="ns-text" style="margin:24px 0 8px;font-family:${HEADING_FONT};font-size:17px;line-height:22px;font-weight:900;color:${EMAIL_COLORS.encre};">${escapeHtml(text)}</p>`;
}

function block(item: EmailBlock, raw: boolean): string {
  switch (item.kind) {
    case "paragraph":
      return paragraph(item.text, item.strong);
    case "facts":
      return facts(item.rows);
    case "button":
      return button(item.label, item.url, raw);
    case "small":
      return small(item.text);
    case "heading":
      return heading(item.text);
    case "link":
      return `<p class="ns-text" style="margin:0 0 16px;font-family:${BODY_FONT};font-size:15px;line-height:22px;color:${EMAIL_COLORS.encre};"><a class="ns-link" href="${href(item.url, raw)}" target="_blank" style="color:${EMAIL_COLORS.marque};font-weight:bold;">${escapeHtml(item.label)}</a><br><span class="ns-muted" style="font-size:13px;color:${EMAIL_COLORS.attenue};word-break:break-all;">${raw ? item.url : escapeHtml(item.url)}</span></p>`;
  }
}

// Pied : identité de l'éditeur et politique de confidentialité, sur chaque email.
function footer(siteUrl: string, raw: boolean): string {
  const privacy = href(`${siteUrl}/confidentialite`, raw);
  const style = `margin:0 0 6px;font-family:${BODY_FONT};font-size:12px;line-height:18px;color:${EMAIL_COLORS.attenue};`;
  return [
    `<p class="ns-muted" style="${style}">${escapeHtml(BRAND.name)} est édité par ${escapeHtml(SELLER.name)}, entrepreneur individuel, ${escapeHtml(SELLER.address.replace(", France", ""))}. SIRET ${escapeHtml(SELLER.siret)}.</p>`,
    `<p class="ns-muted" style="${style}"><a class="ns-link" href="${privacy}" target="_blank" style="color:${EMAIL_COLORS.marque};">Politique de confidentialité</a> · <a class="ns-link" href="mailto:${escapeHtml(SELLER.email)}" style="color:${EMAIL_COLORS.marque};">${escapeHtml(SELLER.email)}</a></p>`,
  ].join("");
}

export function renderEmail(layout: EmailLayout): string {
  const raw = layout.templateUrls === true;
  const logo = href(`${layout.siteUrl}${EMAIL_LOGO.path}`, raw);
  const body = layout.blocks.map((item) => block(item, raw)).join("\n");
  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(layout.subject)}</title>
<style>
${HEAD_STYLE}
</style>
</head>
<body class="ns-page" style="margin:0;padding:0;background-color:${EMAIL_COLORS.creme};">
<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(layout.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.creme}" class="ns-page" style="background-color:${EMAIL_COLORS.creme};">
<tr><td align="center" style="padding:0;">
<!--[if mso]><table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" class="ns-container" style="width:100%;max-width:${EMAIL_WIDTH}px;">
<tr><td bgcolor="${EMAIL_COLORS.marque}" class="ns-pad" style="background-color:${EMAIL_COLORS.marque};padding:24px 32px;">
<img src="${logo}" width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}" alt="${escapeHtml(BRAND.name)}" style="display:block;border:0;outline:none;text-decoration:none;height:${EMAIL_LOGO.height}px;width:${EMAIL_LOGO.width}px;font-family:${HEADING_FONT};font-size:24px;line-height:40px;font-weight:900;color:${EMAIL_COLORS.creme};">
</td></tr>
<tr><td bgcolor="${EMAIL_COLORS.creme}" class="ns-card ns-pad" style="background-color:${EMAIL_COLORS.creme};padding:32px 32px 8px;">
<h1 class="ns-text ns-title" style="margin:0 0 20px;font-family:${HEADING_FONT};font-size:28px;line-height:34px;font-weight:900;color:${EMAIL_COLORS.encre};">${escapeHtml(layout.title)}</h1>
${body}
</td></tr>
<tr><td bgcolor="${EMAIL_COLORS.creme}" class="ns-card ns-pad" style="background-color:${EMAIL_COLORS.creme};padding:8px 32px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ns-rule" style="border-top:2px solid ${EMAIL_COLORS.encre};padding-top:16px;">
${footer(layout.siteUrl, raw)}
</td></tr></table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}
