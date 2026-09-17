// Couleurs utilisées là où les variables CSS ne sont pas lues : icônes PNG
// (app/icon1.tsx, app/apple-icon.tsx), carte partageable (next/og) et couleur
// de thème du navigateur. Copie de app/globals.css, égalité vérifiée par
// tests/design.test.ts.
export const STATIC_PALETTE = {
  marque: "#1f3cff",
  creme: "#fff7e8",
  encre: "#14120c",
  // Aplats de bande posés sur le bleu marque.
  bandOnMarque: {
    bad: "#ff9da6",
    weak: "#ffa360",
    fair: "#ffc400",
    good: "#25d465",
    excellent: "#00d49a",
  },
} as const;
