// Géométrie du signe Negoscore : une jauge, arc de 270° ouvert en bas, et un
// index qui pointe une valeur. Partagée par le composant React et par les
// icônes générées (app/icon.svg est la version statique de ces calculs).

export const MARK_VIEWBOX = 32;
const CENTER = 16;
const RADIUS = 11.5;
const START_DEG = 135; // bas gauche (axe y vers le bas)
const SWEEP_DEG = 270;

function point(deg: number, radius: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [round(CENTER + radius * Math.cos(rad)), round(CENTER + radius * Math.sin(rad))];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Arc complet de la jauge, de 135° à 45° en passant par le haut.
export function gaugeArcPath(): string {
  const [sx, sy] = point(START_DEG, RADIUS);
  const [ex, ey] = point(START_DEG + SWEEP_DEG, RADIUS);
  return `M ${sx} ${sy} A ${RADIUS} ${RADIUS} 0 1 1 ${ex} ${ey}`;
}

// Extrémité de l'index pour une valeur de 0 à 100.
export function needleEnd(value: number): [number, number] {
  const clamped = Math.min(100, Math.max(0, value));
  return point(START_DEG + (SWEEP_DEG * clamped) / 100, RADIUS - 4);
}

export const MARK = { center: CENTER, stroke: 3, hub: 2.5, needleStroke: 2.5 } as const;
