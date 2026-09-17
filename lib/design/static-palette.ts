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
  // Aplats de bande posés sur le bleu marque.
  bandOnMarque: {
    bad: "#ff9da6",
    weak: "#ffa360",
    fair: "#ffc400",
    good: "#25d465",
    excellent: "#00d49a",
  },
} as const;
