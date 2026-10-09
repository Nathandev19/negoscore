// Couleurs utilisées là où les variables CSS ne sont pas lues : icônes PNG
// (app/icon1.tsx, app/apple-icon.tsx), carte partageable (next/og), emails
// (lib/email/layout.ts) et couleur de thème du navigateur. Copie de app/globals.css, égalité vérifiée par
// tests/design.test.ts.
export const STATIC_PALETTE = {
  marque: "#1f3cff",
  marqueDeep: "#0f22b8",
  creme: "#fff7e8",
  encre: "#14120c",
  encreDouce: "#3b362a",
  attenue: "#6e6759",
  filet: "#e4dcc9",
  // Mode sombre des emails seulement (le site n'a pas de mode sombre) : texte
  // secondaire et liens sur fond encre. Aucune variable CSS correspondante.
  emailDark: {
    attenue: "#b8af9e",
    lien: "#aeb9ff",
  },
  // Mission #168 — le blanc de la carte partageable, et lui seul. Le site n'a
  // pas de blanc : son fond est la crème. La carte, elle, pose du texte sur le
  // bleu de marque, où la crème tire vers le jaune à côté des aplats de bande.
  // Aucune variable CSS correspondante, donc rien à vérifier contre
  // globals.css : ces valeurs n'existent que pour l'image.
  surMarque: {
    plein: "#ffffff",
    // Les seconds rôles de la carte : intitulés, ligne d'offre, barème.
    attenue: "rgba(255,255,255,0.6)",
    discret: "rgba(255,255,255,0.5)",
  },
  // Aplats de bande posés sur le bleu marque.
  bandOnMarque: {
    bad: "#ff9da6",
    weak: "#ffa360",
    fair: "#ffc400",
    good: "#25d465",
    excellent: "#00d49a",
  },
} as const;
