// Couleurs des icônes générées en PNG (app/icon1.tsx, app/apple-icon.tsx) et
// de la couleur de thème du navigateur : le moteur d'image ne lit pas les
// variables CSS. Copie de app/globals.css, dont l'égalité est vérifiée par
// tests/design.test.ts. Encre sur papier, aucune couleur de marque.
export const ICON_PALETTE = {
  encre: "#141310",
  papier: "#faf8f4",
} as const;
