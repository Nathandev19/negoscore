import { BRAND } from "@/lib/brand";
import { renderEmail } from "@/lib/email/layout";

// Gabarits des emails d'authentification (mission #044). Ils ne sont PAS
// envoyés par le code : Supabase Auth les envoie, avec le HTML collé dans le
// tableau de bord (Authentication → Emails → Templates). Ce fichier est la
// source ; supabase/templates/*.html en est la copie prête à coller, vérifiée
// identique par tests/email-html.test.ts (pnpm email:templates la régénère).
//
// Variables Supabase à conserver telles quelles : une variable perdue casse la
// connexion de tout le monde.
//   {{ .SiteURL }}    URL du site (réglage « Site URL » du projet)
//   {{ .TokenHash }}  jeton à usage unique vérifié par /auth/confirm
//   {{ .RedirectTo }} page où revenir après connexion (paramètre next)
//   {{ .Email }}      adresse qui a demandé le lien
// Format du lien, le même que app/auth/confirm/route.ts attend :
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
//
// Durée de validité : une heure, réglage « Email OTP Expiration » du projet
// Supabase (3 600 s par défaut), déjà annoncée sur /connexion. À changer ici si
// le réglage change.

export const SIGN_IN_LINK = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}";
export const AUTH_TEMPLATE_VARIABLES = ["{{ .SiteURL }}", "{{ .TokenHash }}", "{{ .RedirectTo }}", "{{ .Email }}"] as const;

export type AuthTemplate = { name: string; file: string; dashboardEntry: string; subject: string; html: string };

const SUBJECT = `Ton lien de connexion ${BRAND.name}`;
const VALIDITY = "Ce lien est valable une heure et ne sert qu'une fois. Passé ce délai, redemande un lien sur la page de connexion.";

function template(options: { intro: string; ignore: string }): string {
  return renderEmail({
    subject: SUBJECT,
    preheader: "Un clic pour te connecter. Lien valable une heure.",
    title: "Ton lien de connexion",
    siteUrl: "{{ .SiteURL }}",
    templateUrls: true,
    blocks: [
      { kind: "paragraph", text: `Tu as demandé à te connecter à ${BRAND.name} avec l'adresse {{ .Email }}.` },
      { kind: "paragraph", text: options.intro },
      { kind: "button", label: "Me connecter", url: SIGN_IN_LINK },
      { kind: "small", text: VALIDITY },
      { kind: "heading", text: "Tu n'as rien demandé ?" },
      { kind: "paragraph", text: options.ignore },
    ],
  });
}

export function authTemplates(): AuthTemplate[] {
  return [
    {
      name: "Lien de connexion (compte existant)",
      file: "supabase/templates/magic-link.html",
      dashboardEntry: "Magic Link",
      subject: SUBJECT,
      html: template({
        intro:
          "Clique sur le bouton pour ouvrir ta session : tu retrouves ton analyse complète, avec la contre-offre chiffrée et le message prêt à envoyer.",
        ignore: "Ignore cet email. Sans clic sur ce lien, personne ne peut se connecter à ton compte.",
      }),
    },
    {
      name: "Lien de connexion (première connexion)",
      file: "supabase/templates/confirm-signup.html",
      dashboardEntry: "Confirm signup",
      subject: SUBJECT,
      html: template({
        intro:
          "C'est ta première connexion : ton compte s'active quand tu cliques. Tu retrouves ensuite ton analyse complète, avec la contre-offre chiffrée et le message prêt à envoyer.",
        ignore: "Ignore cet email. Sans clic sur ce lien, ton adresse n'est pas confirmée et aucun compte n'est activé.",
      }),
    },
  ];
}
