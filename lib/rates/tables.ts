import current from "@/lib/rates/fr-2026.4.json";
import fr20263 from "@/lib/rates/fr-2026.3.json";
import fr20262 from "@/lib/rates/fr-2026.2.json";

// Mission #085 — une analyse garde la table avec laquelle elle a été faite.
// Toutes les tables que le moteur actuel sait appliquer EXACTEMENT, par
// version. Une table n'entre ici que si le moteur la calcule comme au jour de
// l'analyse :
//   - fr-2026.4 : la table actuelle. Mission #160 — elle ajoute les ZONES de
//     territoire (territory_zones) et ne change RIEN d'autre : mêmes tarifs,
//     mêmes multiplicateurs, mêmes plafonds, mêmes seuils que fr-2026.3,
//     vérifié champ par champ. Une analyse faite en fr-2026.3 n'a pas de zones
//     et rend donc exactement le même chiffrage qu'avant ;
//   - fr-2026.3 : même table sans les zones ;
//   - fr-2026.2 : mêmes tarifs, multiplicateurs, plafonds et seuils que
//     fr-2026.3 ; seul le niveau par défaut différait (confirmé), et le moteur
//     reçoit toujours le niveau explicitement (tests/rate-tables.test.ts le
//     vérifie champ par champ).
// fr-2026.1 n'y est pas : sa dégressivité par paliers n'existe plus dans le
// moteur (remplacée par une fonction continue en fr-2026.2). Une analyse faite
// avec elle garde ses chiffres enregistrés, et la page dit qu'ils ne peuvent
// pas être recalculés (lib/analysis/recompute.ts).

export type RateTable = typeof current;

export const CURRENT_RATE_TABLE: RateTable = current;
export const CURRENT_RATE_VERSION = current.version;

const TABLES: Readonly<Record<string, RateTable>> = {
  [current.version]: current,
  [fr20263.version]: fr20263 as RateTable,
  [fr20262.version]: fr20262 as RateTable,
};

// null : cette version n'existe plus dans le code. L'appelant ne doit JAMAIS
// substituer la table courante sans le dire.
export function rateTable(version: string): RateTable | null {
  return TABLES[version] ?? null;
}

export function knownRateVersions(): string[] {
  return Object.keys(TABLES);
}
