// Géométrie du signe Negoscore : un €. L'arc de l'ancienne jauge devient la
// courbe du €, ouverte à droite ; l'aiguille en devient la barre horizontale.
// Traits épais et une seule barre : le signe reste lisible à 16 px.
// Partagée par le composant React, les icônes générées et la carte
// partageable (app/icon.svg et public/brand/*.svg en sont la version statique,
// vérifiée par tests/design.test.ts).

export const MARK_VIEWBOX = 32;
const CENTER_X = 18;
const CENTER_Y = 16;
const RADIUS = 10;
// Ouverture du € à droite : de 50° au-dessus de l'horizontale à 50° en dessous.
const OPENING_DEG = 50;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Courbe du € : grand arc qui passe par la gauche (sens antihoraire à l'écran).
export function euroArcPath(): string {
  const rad = (OPENING_DEG * Math.PI) / 180;
  const x = round(CENTER_X + RADIUS * Math.cos(rad));
  const top = round(CENTER_Y - RADIUS * Math.sin(rad));
  const bottom = round(CENTER_Y + RADIUS * Math.sin(rad));
  return `M ${x} ${top} A ${RADIUS} ${RADIUS} 0 1 0 ${x} ${bottom}`;
}

// Barre horizontale, qui dépasse la courbe à gauche comme la barre d'un €.
export const EURO_BAR = { x1: 4, x2: 20, y: CENTER_Y } as const;

export const MARK = { stroke: 4 } as const;

// Le SVG complet, pour les fichiers statiques et les rendus hors React.
export function markSvg({ color, background }: { color: string; background?: string }): string {
  const rect = background ? `<rect width="32" height="32" fill="${background}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">${rect}` +
    `<path d="${euroArcPath()}" stroke="${color}" stroke-width="${MARK.stroke}" stroke-linecap="round"/>` +
    `<line x1="${EURO_BAR.x1}" y1="${EURO_BAR.y}" x2="${EURO_BAR.x2}" y2="${EURO_BAR.y}" stroke="${color}" stroke-width="${MARK.stroke}" stroke-linecap="round"/></svg>`
  );
}
