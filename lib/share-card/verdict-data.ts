import { selectRows } from "@/lib/supabase/server";
import { requestedZones } from "@/lib/rates/zones";
import type { VerdictCardData } from "@/lib/share-card/verdict-card";

// Mission #165 — CE QUE LA ROUTE DE LA CARTE A LE DROIT DE LIRE.
//
// La règle, non négociable : la requête nomme SES colonnes, une par une, et le
// nom de la marque n'entre jamais en mémoire. Pas de `select=*`, et pas de
// `payload` en bloc — le payload d'une analyse contient `deal.brand`, et le
// charger pour n'en afficher qu'un montant reviendrait à faire transiter le
// nom de l'annonceur par une route qui fabrique une image destinée à être
// postée publiquement.
//
// PostgREST sait projeter des CHEMINS JSON (`alias:payload->deal->…`) : c'est
// ce qui permet de ne faire venir que des nombres, des booléens et des clés de
// listes fermées. Le même procédé est déjà utilisé par /historique.
//
// Ce tableau est la liste auditée. tests/carte-verdict.test.tsx échoue si une
// entrée porte la marque ou l'annonceur, et si la route sélectionne autre
// chose que lui.
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
  // De quoi écrire la ligne d'offre, et rien d'autre.
  "livrables:payload->deal->deliverables",
  "droits_mois:payload->deal->usage->duration_months",
  "droits_a_vie:payload->deal->usage->perpetual",
  "zones:payload->deal->usage->territory_zones",
  "exclusivite:payload->deal->exclusivity->present",
  "exclusivite_mois:payload->deal->exclusivity->duration_months",
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

export type LigneCarte = Record<string, unknown>;

// La ligne de base, traduite en données de carte. Tout ce qui n'est pas du
// type attendu devient null : une carte à moitié fausse ne se produit pas.
export function verdictDataFromRow(row: LigneCarte): VerdictCardData {
  const bande = typeof row.bande === "string" && BANDES.has(row.bande) ? (row.bande as VerdictCardData["bande"]) : null;
  return {
    propose: nombre(row.propose),
    produits: nombre(row.produits),
    bas: nombre(row.bas),
    haut: nombre(row.haut),
    // Le verdict n'existe que sur une analyse complète : une offre « à
    // préciser » n'a pas de bande, et la carte ne sera pas produite.
    bande: row.evaluabilite === "complete" ? bande : null,
    livrables: livrablesDe(row.livrables),
    droitsMois: nombre(row.droits_mois),
    droitsAVie: row.droits_a_vie === true,
    exclusivite: row.exclusivite === true,
    exclusiviteMois: nombre(row.exclusivite_mois),
    // Filtrées par la liste fermée de la table de tarifs : une zone inconnue
    // est écartée, jamais affichée telle quelle.
    zones: requestedZones(Array.isArray(row.zones) ? row.zones.filter((z): z is string => typeof z === "string") : []),
    bareme: typeof row.rate_table_version === "string" ? row.rate_table_version : "",
  };
}

// L'analyse la plus récente du navigateur qui porte ce jeton anonyme.
//
// Le jeton est lu par le serveur dans un cookie httpOnly : il n'y a ni
// identifiant dans l'adresse, ni paramètre à deviner. Connaître l'adresse de
// la route ne donne donc accès à rien.
export async function latestVerdictData(anonToken: string): Promise<VerdictCardData | null> {
  const rows = await selectRows<LigneCarte>(
    "analyses",
    `select=${CARTE_COLONNES.join(",")},deal:deals!inner(anon_token)` +
      `&deal.anon_token=eq.${encodeURIComponent(anonToken)}` +
      `&order=created_at.desc&limit=1`,
  );
  const row = rows[0];
  return row ? verdictDataFromRow(row) : null;
}
