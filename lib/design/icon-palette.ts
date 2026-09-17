// Couleurs des icônes générées en PNG (app/icon1.tsx, app/apple-icon.tsx) :
// le moteur d'image ne lit pas les variables CSS. Copie de app/globals.css,
// dont l'égalité est vérifiée par tests/design.test.ts.
export const ICON_PALETTE = {
  brand: "#5a4af4",
  ink: "#0e0e12",
  surface: "#ffffff",
} as const;
