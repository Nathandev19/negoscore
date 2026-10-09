import { selectRows } from "@/lib/supabase/server";
import { requestedZones } from "@/lib/rates/zones";
import { parseTier } from "@/lib/rates/tier";
import { TURNS_TABLE, type Thread } from "@/lib/negotiation/store";
import type { Pricing } from "@/lib/negotiation/types";
import type { ResultView } from "@/lib/analysis/lock";
import { comparedAmountOf } from "@/lib/rates/score";
import type { VerdictCardData } from "@/lib/share-card/verdict-card";

// Mission #165, étendue par la #169 — CE QUE LA ROUTE DE LA CARTE A LE DROIT
// DE LIRE.
//
// La règle, non négociable : la requête nomme SES colonnes, une par une, et le
// nom de la marque n'entre jamais en mémoire. Pas de `select=*`, et pas de
// `payload` en bloc — le payload d'une analyse contient `deal.brand`, et le
// charger pour n'en afficher qu'un montant reviendrait à faire transiter le
// nom de l'annonceur par une route qui fabrique une image destinée à être
// postée publiquement.
//
// Mission #169 : la même discipline vaut pour le FIL DE NÉGOCIATION, où elle
// est encore plus sévère. Le fil contient `brand_reply`, c'est-à-dire le texte
// des messages de la marque, et `deal_after.brand`. La route ne lit ni l'un ni
// l'autre : elle lit le CHIFFRAGE, calculé et enregistré à l'écriture du tour
// (lib/negotiation/pricing.ts), et les quelques champs typés qui composent la
// ligne d'offre.
//
// PostgREST sait projeter des CHEMINS JSON (`alias:payload->deal->…`) : c'est
// ce qui permet de ne faire venir que des nombres, des booléens et des clés de
// listes fermées. Le même procédé est déjà utilisé par /historique.
//
// Ces tableaux sont la liste auditée. tests/carte-verdict.test.tsx échoue si
// une entrée porte la marque ou l'annonceur, si elle désigne autre chose qu'un
// scalaire, et si la route sélectionne autre chose qu'eux.
export const CARTE_COLONNES = [
  // Colonne réelle de la table : la version qui a produit ces chiffres.
  "rate_table_version",
  // Ce que la marque met sur la table.
  "propose:payload->deal->payment->amount_eur",
  "produits:payload->deal->in_kind_value_eur",
  // Ce que ça vaut.
  "bas:payload->estimate->total_low",
  "haut:payload->estimate->total_high",
  "bande:payload->score->>band",
  "evaluabilite:payload->>evaluability",
  // Mission #168 — le niveau de calcul (#039). Il figure toujours sur la
  // carte : la même offre ne vaut pas la même chose selon le niveau, et une
  // fourchette sans son niveau ne correspond à rien de vérifiable.
  "niveau:payload->>profile_tier",
  // De quoi écrire la ligne d'offre, et rien d'autre.
  "livrables:payload->deal->deliverables",
  "droits_mois:payload->deal->usage->duration_months",
  "droits_a_vie:payload->deal->usage->perpetual",
  "zones:payload->deal->usage->territory_zones",
  "exclusivite:payload->deal->exclusivity->present",
  "exclusivite_mois:payload->deal->exclusivity->duration_months",
] as const;

// Mission #169 — LE FIL, ET RIEN QUE SON CHIFFRAGE.
//
// Trois blocs de chiffrage, parce qu'il y en a trois à lire selon la ligne :
//   - `pricing_after` : le chiffrage du tour, quand un terme a changé ;
//   - `pricing_before` : celui qui fait foi quand le tour n'a rien changé ;
//   - `pricing` : celui de la ligne de conclusion (#169).
// Et les six champs typés de la ligne d'offre, pris sur les termes du tour
// (`deal_after`) ou sur ceux de la conclusion (`deal`).
//
// AUCUNE ENTRÉE NE TOUCHE `brand_reply`, `deal_after->brand` NI `payload` EN
// BLOC. Vérifié par tests/carte-verdict.test.tsx, sur cette liste et sur la
// requête réellement émise.
const BLOC_CHIFFRAGE = ["total_low", "total_high", "compared", "ceiling", "band", "rate_table_version", "tier"] as const;
const CHAMPS_OFFRE = [
  ["livrables", "deliverables"],
  ["droits_mois", "usage->duration_months"],
  ["droits_a_vie", "usage->perpetual"],
  ["zones", "usage->territory_zones"],
  ["exclusivite", "exclusivity->present"],
  ["exclusivite_mois", "exclusivity->duration_months"],
] as const;

// `->>` pour le texte (band, rate_table_version, tier) : PostgREST rend alors
// une feuille, jamais un sous-objet.
const chiffrage = (prefixe: string, bloc: string) =>
  BLOC_CHIFFRAGE.map((champ) => {
    const texte = champ === "band" || champ === "rate_table_version" || champ === "tier";
    return `${prefixe}_${champ}:payload->${bloc}->${texte ? ">" : ""}${champ}`;
  });

const offre = (prefixe: string, bloc: string) =>
  CHAMPS_OFFRE.map(([alias, chemin]) => `${prefixe}_${alias}:payload->${bloc}->${chemin}`);

export const CARTE_COLONNES_FIL = [
  "kind",
  "turn_number",
  "created_at",
  // Table de l'analyse disparue du code (#085) : aucun chiffre, donc pas de
  // carte — jamais un repli sur les chiffres d'origine.
  "indisponible:payload->pricing_unavailable",
  ...chiffrage("apres", "pricing_after"),
  ...chiffrage("avant", "pricing_before"),
  ...chiffrage("fin", "pricing"),
  ...offre("apres", "deal_after"),
  ...offre("fin", "deal"),
] as const;

// Un mot de prudence sur `livrables` : PostgREST ne sait pas projeter À
// L'INTÉRIEUR d'un tableau JSON. La liste arrive donc entière, `format` et
// `platform` compris, et `format` est du texte libre écrit par le modèle
// (« 30 s, 3 hooks »). Il n'est JAMAIS lu : la projection ci-dessous ne garde
// que le type et la quantité, et la carte n'a accès qu'à cette projection.
type LivrableBrut = { type?: unknown; quantity?: unknown };

const TYPES = new Set(["video", "photo", "story", "live"]);

function livrablesDe(valeur: unknown): VerdictCardData["livrables"] {
  if (!Array.isArray(valeur)) return [];
  return valeur
    .map((item) => (item && typeof item === "object" ? (item as LivrableBrut) : {}))
    .filter((item): item is { type: string; quantity: unknown } => typeof item.type === "string" && TYPES.has(item.type))
    .map((item) => ({
      type: item.type as VerdictCardData["livrables"][number]["type"],
      quantity: typeof item.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : null,
    }));
}

const nombre = (valeur: unknown): number | null =>
  typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;

const BANDES = new Set(["bad", "weak", "fair", "good", "excellent"]);
const bandeDe = (valeur: unknown): VerdictCardData["bande"] =>
  typeof valeur === "string" && BANDES.has(valeur) ? (valeur as VerdictCardData["bande"]) : null;

export type LigneCarte = Record<string, unknown>;

// ─── Ce qui compose une carte, d'où qu'elle vienne ──────────────────────────
//
// Mission #169 — UN SEUL CONSTRUCTEUR, pour que la page et la route ne
// puissent pas être en désaccord. La page tient le fil en mémoire et décide
// d'afficher le bouton ; la route lit des colonnes projetées et décide de
// rendre l'image. Si les deux jugeaient séparément, un bouton pourrait mener
// à un 404 — ce que la mission interdit explicitement.
//
// Les deux passent donc par ici, avec la MÊME forme : le chiffrage tel qu'il
// est enregistré (`Pricing`), et les six champs typés de la ligne d'offre.
export type LigneOffre = {
  livrables: VerdictCardData["livrables"];
  droitsMois: number | null;
  droitsAVie: boolean;
  exclusivite: boolean;
  exclusiviteMois: number | null;
  zones: string[];
};

export function carteDepuisChiffrage(pricing: Pricing, ligne: LigneOffre): VerdictCardData {
  return {
    // Le montant comparé est décidé à l'enregistrement (#167, #169) : argent
    // d'abord, produits à défaut, ou le plafond annoncé quand il y en a un.
    // La carte n'en choisit pas un autre, elle affiche celui-là.
    propose: pricing.compared,
    produits: null,
    bas: pricing.total_low,
    haut: pricing.total_high,
    bande: pricing.band,
    livrables: ligne.livrables,
    droitsMois: ligne.droitsMois,
    droitsAVie: ligne.droitsAVie,
    exclusivite: ligne.exclusivite,
    exclusiviteMois: ligne.exclusiviteMois,
    zones: ligne.zones,
    bareme: pricing.rate_table_version,
    niveau: parseTier(pricing.tier),
    plafond: pricing.ceiling,
  };
}

// La ligne d'offre d'un deal tenu en mémoire (page de résultat). Elle ne lit
// que des champs typés : ni `brand`, ni `format`, ni `territory` en toutes
// lettres — la même discipline que la projection.
export function ligneOffreDuDeal(deal: {
  deliverables: ReadonlyArray<{ type: string; quantity: number | null }>;
  usage: { duration_months: number | null; perpetual: boolean };
  exclusivity: { present: boolean; duration_months: number | null };
}): LigneOffre {
  return {
    livrables: livrablesDe(deal.deliverables),
    droitsMois: deal.usage.duration_months,
    droitsAVie: deal.usage.perpetual,
    exclusivite: deal.exclusivity.present,
    exclusiviteMois: deal.exclusivity.duration_months,
    zones: requestedZones((deal.usage as { territory_zones?: unknown }).territory_zones as string[] | undefined),
  };
}

// La ligne de base d'une analyse, traduite en données de carte. Tout ce qui
// n'est pas du type attendu devient null : une carte à moitié fausse ne se
// produit pas.
export function verdictDataFromRow(row: LigneCarte): VerdictCardData {
  return {
    propose: nombre(row.propose),
    produits: nombre(row.produits),
    bas: nombre(row.bas),
    haut: nombre(row.haut),
    // Le verdict n'existe que sur une analyse complète : une offre « à
    // préciser » n'a pas de bande, et la carte ne sera pas produite.
    bande: row.evaluabilite === "complete" ? bandeDe(row.bande) : null,
    livrables: livrablesDe(row.livrables),
    droitsMois: nombre(row.droits_mois),
    droitsAVie: row.droits_a_vie === true,
    exclusivite: row.exclusivite === true,
    exclusiviteMois: nombre(row.exclusivite_mois),
    // Filtrées par la liste fermée de la table de tarifs : une zone inconnue
    // est écartée, jamais affichée telle quelle.
    zones: requestedZones(Array.isArray(row.zones) ? row.zones.filter((z): z is string => typeof z === "string") : []),
    bareme: typeof row.rate_table_version === "string" ? row.rate_table_version : "",
    // Liste fermée : une valeur inconnue devient null et le niveau ne
    // s'affiche pas, plutôt que d'écrire n'importe quoi sous la fourchette.
    niveau: parseTier(row.niveau),
    // L'offre d'origine n'a pas de plafond annoncé : c'est une notion du fil.
    plafond: false,
  };
}

// ─── Le fil, lu par projection ──────────────────────────────────────────────

function chiffrageDeLigne(row: LigneCarte, prefixe: string): Pricing | null {
  const version = row[`${prefixe}_rate_table_version`];
  // Bloc absent (tour sans changement, conclusion d'avant la #169) : il n'y a
  // rien à lire, et c'est un autre bloc qui fait foi.
  if (typeof version !== "string") return null;
  return {
    total_low: nombre(row[`${prefixe}_total_low`]),
    total_high: nombre(row[`${prefixe}_total_high`]),
    counter_low: null,
    counter_high: null,
    rate_table_version: version,
    tier: (parseTier(row[`${prefixe}_tier`]) ?? "confirmed") as Pricing["tier"],
    score: null,
    band: bandeDe(row[`${prefixe}_band`]),
    compared: nombre(row[`${prefixe}_compared`]),
    ceiling: row[`${prefixe}_ceiling`] === true,
  };
}

function ligneOffreDeLigne(row: LigneCarte, prefixe: string): LigneOffre {
  return {
    livrables: livrablesDe(row[`${prefixe}_livrables`]),
    droitsMois: nombre(row[`${prefixe}_droits_mois`]),
    droitsAVie: row[`${prefixe}_droits_a_vie`] === true,
    exclusivite: row[`${prefixe}_exclusivite`] === true,
    exclusiviteMois: nombre(row[`${prefixe}_exclusivite_mois`]),
    zones: requestedZones(
      Array.isArray(row[`${prefixe}_zones`])
        ? (row[`${prefixe}_zones`] as unknown[]).filter((z): z is string => typeof z === "string")
        : [],
    ),
  };
}

// Les termes ACTUELS, tels que le fil les a enregistrés. Même ordre de
// priorité que lib/negotiation/current.ts : la conclusion prime, sinon le
// dernier tour. Deux endroits qui trancheraient différemment finiraient par
// montrer deux états du même deal.
//
// null : aucun tour, la carte est celle de l'offre d'origine.
// "indisponible" : les termes ont changé mais la table de l'analyse a disparu
// du code (#085) — pas de carte, et surtout aucun repli sur les chiffres
// d'origine, qui ne décrivent plus l'offre.
// PAS DE BANDE, PAS DE CARTE — et c'est un refus, pas une carte incomplète.
// Un tour enregistré avant la #169 n'en a pas. Le dire explicitement évite
// qu'un `??` se rabatte un jour sur les chiffres de l'offre d'origine, qui ne
// décrivent plus ce qui est sur la table.
function sansVerdict(pricing: Pricing | null): boolean {
  return pricing === null || pricing.band === null;
}

export function carteDuFil(rows: readonly LigneCarte[]): VerdictCardData | null | "indisponible" {
  const conclusion = rows.find((row) => row.kind === "conclusion");
  const tours = rows
    .filter((row) => row.kind === "reply" && typeof row.turn_number === "number")
    .sort((a, b) => (a.turn_number as number) - (b.turn_number as number));
  const dernier = tours.at(-1);
  if (!conclusion && !dernier) return null;
  if (dernier?.indisponible === true) return "indisponible";

  if (conclusion) {
    const pricing = chiffrageDeLigne(conclusion, "fin");
    // Conclusion enregistrée avant la #169 : aucun chiffrage. On ne retombe
    // pas sur le dernier tour — la conclusion peut porter d'autres termes.
    if (sansVerdict(pricing)) return "indisponible";
    return carteDepuisChiffrage(pricing!, ligneOffreDeLigne(conclusion, "fin"));
  }

  const pricing = chiffrageDeLigne(dernier!, "apres") ?? chiffrageDeLigne(dernier!, "avant");
  if (sansVerdict(pricing)) return "indisponible";
  return carteDepuisChiffrage(pricing!, ligneOffreDeLigne(dernier!, "apres"));
}

// ─── Les mêmes règles, sur un fil DÉJÀ CHARGÉ ───────────────────────────────
//
// La page de résultat tient le fil complet en mémoire : c'est sa page, elle a
// le droit d'y lire le nom de la marque. Elle ne doit pas pour autant juger
// de la carte autrement que la route, sinon le bouton mènerait à un 404.
//
// Les deux fonctions ci-dessous appliquent donc EXACTEMENT la même règle que
// carteDuFil : la conclusion prime, sinon le dernier tour ; pricing_after
// sinon pricing_before ; pas de bande, pas de carte.
// tests/carte-fil.test.ts fait passer le même fil par les deux chemins et
// exige le même résultat.
export function carteDuFilCharge(thread: Thread | null): VerdictCardData | null | "indisponible" {
  const dernier = thread?.turns.at(-1);
  const conclusion = thread?.conclusion ?? null;
  if (!conclusion && !dernier) return null;
  if (dernier?.payload.pricing_unavailable === true) return "indisponible";
  if (conclusion) {
    const pricing = conclusion.payload.pricing;
    if (sansVerdict(pricing)) return "indisponible";
    return carteDepuisChiffrage(pricing!, ligneOffreDuDeal(conclusion.payload.deal));
  }
  const pricing = dernier!.payload.pricing_after ?? dernier!.payload.pricing_before;
  if (sansVerdict(pricing)) return "indisponible";
  return carteDepuisChiffrage(pricing!, ligneOffreDuDeal(dernier!.payload.deal_after));
}

// L'offre d'origine, depuis l'analyse telle que la page l'affiche. Même
// contenu que verdictDataFromRow, mais depuis l'objet plutôt que depuis les
// colonnes projetées.
export function carteDeLAnalyse(analysis: ResultView): VerdictCardData {
  return {
    propose: comparedAmountOf(analysis.deal),
    produits: null,
    bas: analysis.estimate.total_low,
    haut: analysis.estimate.total_high,
    bande: analysis.evaluability === "complete" ? (analysis.score?.band ?? null) : null,
    ...ligneOffreDuDeal(analysis.deal),
    bareme: analysis.estimate.rate_table_version,
    niveau: analysis.profile_tier,
    // Une offre d'origine n'a pas de plafond annoncé : « jusqu'à … à
    // confirmer » est une notion du fil de négociation, et elle y est lue
    // (pricing.ceiling), jamais câblée.
    plafond: false,
  };
}

// ─── La lecture ─────────────────────────────────────────────────────────────

export type Viewer = { userId: string | null; anonToken: string | null };

// L'analyse, si elle appartient bien à qui la demande. LE FILTRE EST LE
// CONTRÔLE : une analyse qui n'est ni rattachée à ce compte ni à ce navigateur
// ne remonte pas, et il n'y a donc rien à vérifier ensuite.
//
// Mission #169 — la session vient EN COMPLÉMENT du cookie. Se connecter efface
// le cookie anonyme (lib/auth/sign-in.ts) : sans la session, une personne
// connectée n'aurait plus de carte du tout.
export async function verdictRowFor(analysisId: string, viewer: Viewer): Promise<LigneCarte | null> {
  const filtres = [
    viewer.userId ? `deal.user_id=eq.${encodeURIComponent(viewer.userId)}` : null,
    viewer.anonToken ? `deal.anon_token=eq.${encodeURIComponent(viewer.anonToken)}` : null,
  ].filter((filtre): filtre is string => filtre !== null);
  for (const filtre of filtres) {
    const rows = await selectRows<LigneCarte>(
      "analyses",
      `select=${CARTE_COLONNES.join(",")},deal:deals!inner(anon_token)` +
        `&id=eq.${encodeURIComponent(analysisId)}&${filtre}&limit=1`,
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function filRowsFor(analysisId: string): Promise<LigneCarte[]> {
  return selectRows<LigneCarte>(
    TURNS_TABLE,
    `select=${CARTE_COLONNES_FIL.join(",")}&analysis_id=eq.${encodeURIComponent(analysisId)}&order=created_at.asc`,
  );
}
