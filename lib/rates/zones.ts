import { CURRENT_RATE_TABLE, type RateTable } from "@/lib/rates/tables";
import { entryFor } from "@/lib/lookup";

// Mission #160 — LE TERRITOIRE N'EST PLUS UN INTERRUPTEUR.
//
// Avant : une expression régulière cherchait « monde » dans le texte libre de
// l'offre (lib/rates/engine.ts). « France, Belgique et Suisse » ne contenait
// aucun de ces mots, donc +0 % — pas un réglage trop bas, une règle absente.
// Et une expression régulière sur le texte brut n'est pas une extraction :
// c'est le modèle qui doit sortir la donnée, typée, et le code qui chiffre.
//
// LA LISTE EST FERMÉE ET VIT DANS LA TABLE DE TARIFS (territory_zones), pas
// ici : une zone qui n'y figure pas n'est jamais devinée et n'ajoute rien.
// Ce fichier ne porte que les LIBELLÉS — du texte affiché, qui n'a rien à
// faire dans une table de tarifs — et la lecture de la liste.
//
// LA FRANCE EST UNE ZONE À PART ENTIÈRE, à +0. Elle est dans la table pour
// que le modèle qui lit « diffusion en France » produise une zone CONNUE qui
// vaut zéro, au lieu d'une valeur inconnue qu'on écarterait silencieusement.

export type ZoneKey = string;

// Le libellé de chaque zone, tel qu'il s'affiche sur la ligne de majoration.
// Une zone de la table sans libellé ici fait échouer tests/territoire.test.ts :
// une ligne sans nom ne se conteste pas.
export const ZONE_LABEL: Readonly<Record<string, string>> = {
  france: "France",
  // Mission #167 — « Europe francophone » et non plus « Belgique, Suisse,
  // Luxembourg ». Les quatre autres entrées nomment une ZONE ; celle-ci
  // énumérait ses pays, et c'était la seule. Sur une ligne de territoire
  // séparée par des points médians, une énumération à virgules à l'intérieur
  // d'un élément se lit mal : « France · Belgique, Suisse, Luxembourg ·
  // Amérique du Nord ». Les trois pays restent écrits ici, en commentaire, et
  // dans le prompt d'extraction qui dit au modèle ce que la zone recouvre.
  europe_francophone: "Europe francophone",
  europe: "Reste de l'Europe",
  amerique_nord: "Amérique du Nord",
  reste_du_monde: "Reste du monde",
};

// La zone incluse dans le tarif de base : elle ne se facture pas.
export const HOME_ZONE = "france";

function zonesOf(rates: RateTable): Readonly<Record<string, { low: number; high: number }>> {
  // Une table antérieure à fr-2026.4 n'a pas ce bloc. Une analyse faite avec
  // elle n'a pas de zones non plus, donc le cas ne se présente qu'en lecture
  // défensive — mais il ne doit pas jeter.
  return (rates as { territory_zones?: Readonly<Record<string, { low: number; high: number }>> }).territory_zones ?? {};
}

// Toutes les zones de la table, France comprise, dans l'ordre de la table.
export function allZones(rates: RateTable = CURRENT_RATE_TABLE): string[] {
  return Object.keys(zonesOf(rates));
}

// Les zones FACTURABLES : toutes sauf celle qui est déjà dans le tarif de base.
export function billableZones(rates: RateTable = CURRENT_RATE_TABLE): string[] {
  return allZones(rates).filter((zone) => zone !== HOME_ZONE);
}

// La majoration d'une zone, ou undefined si la table ne la connaît pas.
// `entryFor` : une clé héritée d'Object.prototype (`constructor`, `__proto__`)
// ne doit pas répondre — même garde que les tables d'acquisition.
export function zoneRate(zone: string, rates: RateTable = CURRENT_RATE_TABLE): { low: number; high: number } | undefined {
  return entryFor(zonesOf(rates), zone);
}

// Les zones demandées par l'offre : celles que la table connaît,
// dédoublonnées, dans l'ordre de la table. TOUT ce qui a été demandé, France
// comprise — c'est la liste de ce qu'on affiche. Pour chiffrer, le moteur lit
// `billableRequestedZones`, juste en dessous.
//
// UNE ZONE INCONNUE N'AJOUTE RIEN ET NE FAIT RIEN ÉCHOUER. C'est la règle qui
// vaut partout ailleurs dans le dépôt : on écarte la valeur, jamais la ligne.
export function requestedZones(values: readonly string[] | null | undefined, rates: RateTable = CURRENT_RATE_TABLE): string[] {
  if (!values) return [];
  // Un SEUL filtrage, et c'est celui-ci : on part de la table, pas de ce qui
  // est demandé. Une valeur que la table ne connaît pas n'a aucun moyen
  // d'entrer, et l'ordre affiché est celui de la table, pas celui du modèle.
  // (Une vérification supplémentaire côté « demandé » existait ici : elle ne
  // pouvait rien attraper que celle-ci ne rattrape, et une garde que rien ne
  // peut faire échouer ne garde rien.)
  //
  // Mission #167 — LA FRANCE RESTE. Elle était retirée ici, au motif que sa
  // majoration vaut zéro ; mais ce qui vaut zéro ne se facture pas, ça ne
  // veut pas dire que ça ne s'est pas demandé. Une offre « France, Belgique,
  // Suisse » affichait « Belgique, Suisse, Luxembourg » : on effaçait de
  // l'écran une zone que la marque avait bien demandée.
  //
  // Le moteur, lui, chiffre sur `billableRequestedZones` : rien ne change au
  // prix, et aucune ligne à 0 € n'apparaît.
  const demandees = new Set(values);
  return allZones(rates).filter((zone) => demandees.has(zone));
}

// Les zones demandées QUI SE FACTURENT : les mêmes, moins celle qui est déjà
// comprise dans le tarif de base. C'est ce que lit le moteur.
export function billableRequestedZones(values: readonly string[] | null | undefined, rates: RateTable = CURRENT_RATE_TABLE): string[] {
  return requestedZones(values, rates).filter((zone) => zone !== HOME_ZONE);
}

// Le total des zones demandées.
export function zonesTotal(zones: readonly string[], rates: RateTable = CURRENT_RATE_TABLE): { low: number; high: number } {
  return zones.reduce(
    (total, zone) => {
      const rate = zoneRate(zone, rates);
      return rate ? { low: total.low + rate.low, high: total.high + rate.high } : total;
    },
    { low: 0, high: 0 },
  );
}

// LE PLAFOND DE COHÉRENCE, et il n'est pas négociable : le monde est le
// PLAFOND du territoire, jamais une zone de plus. La somme des zones demandées
// ne peut donc pas dépasser territory_worldwide — si elle le fait, c'est le
// monde qui est facturé, et c'est le monde qui s'affiche.
//
// Dans fr-2026.4 les quatre zones hors France somment EXACTEMENT au mondial :
// le plafond est structurel, pas un rattrapage. Cette fonction reste la garde
// du jour où quelqu'un retouche une valeur de la table.
export function reachesWorld(zones: readonly string[], rates: RateTable = CURRENT_RATE_TABLE): boolean {
  const monde = rates.multipliers.territory_worldwide;
  const total = zonesTotal(zones, rates);
  return total.low >= monde.low || total.high >= monde.high;
}
