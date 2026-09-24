import type { TermGroup } from "@/lib/negotiation/types";

// Mission #083 — de quoi parle une demande (« Paiement à 30 jours, 50 % à la
// signature ») : du paiement. Sert à relier une demande aux groupes de termes
// suivis (un seul doute par point), à la ligne du récapitulatif qui la porte
// déjà, et aux phrases du message qui en parlent.

export type Topic = {
  key: string;
  // Groupes de termes suivis qui portent ce sujet (aucun : révisions, rushs).
  groups: readonly TermGroup[];
  // Lignes qui portent ce sujet : récapitulatif de la conclusion (« Livrables »)
  // et message de clôture (« Contenus »). Aucune : pas de ligne à lui.
  rows: readonly string[];
  pattern: RegExp;
};

const word = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})`, "iu");

export const TOPICS: readonly Topic[] = [
  // Mission #116 — « un fixe » parle bien de rémunération : sans cette forme,
  // le point « Obtenir un fixe qui couvre la création » n'aurait aucun sujet,
  // et la règle de couverture du message (#115) ne saurait pas le reconnaître.
  { key: "amount", groups: ["amount"], rows: ["Rémunération"], pattern: word("rémunér|budget|tarif|prix|montant|contre-offre|cachet|sous-pay|fixe(?![\\p{L}])|garanti") },
  { key: "payment", groups: ["payment_terms"], rows: ["Paiement"], pattern: word("paiement|payer|payé|acompte|règlement|signature|facturation") },
  { key: "exclusivity", groups: ["exclusivity"], rows: ["Exclusivité"], pattern: word("exclusivit") },
  {
    key: "usage",
    groups: ["usage_rights", "usage_duration"],
    rows: ["Droits d'utilisation"],
    // « Droit » seul ne suffit pas : « droit d'entraînement IA » n'est pas un
    // droit d'utilisation publicitaire (mission #084).
    pattern: word("droits? (?:pub|de diffusion)|pub(?![\\p{L}])|publicit|(?:ré)?utilis|usage|whitelisting|spark"),
  },
  { key: "territory", groups: ["territory"], rows: ["Territoire"], pattern: word("territoire|pays(?![\\p{L}])|zone") },
  { key: "deliverables", groups: ["deliverables"], rows: ["Livrables", "Contenus"], pattern: word("vidéos?(?![\\p{L}])|livrable|stor(?:y|ies)|reels?(?![\\p{L}])") },
  { key: "in_kind", groups: ["in_kind"], rows: [], pattern: word("produits? offert|dotation|en nature") },
  { key: "raw", groups: [], rows: [], pattern: word("raw footage|rushs?(?![\\p{L}])|fichiers? sources?") },
  { key: "revisions", groups: [], rows: [], pattern: word("révision|retouche") },
  // Mission #116 — la rémunération variable. Aucun groupe de termes suivi : ce
  // n'est pas un terme que le moteur chiffre, et il ne doit surtout pas l'être.
  // Le sujet sert à relier les cinq points à obtenir au message qui les porte.
  {
    key: "commission",
    groups: [],
    rows: [],
    pattern: word("commission|affiliation|affili[ée]|code promo|pourcentage|assiette|attribution|rattach[ée]|versement|revers[ée]|seuil"),
  },
];

export function topicsOf(label: string): Topic[] {
  return TOPICS.filter((topic) => topic.pattern.test(label));
}

export function groupsOf(label: string): Set<TermGroup> {
  return new Set(topicsOf(label).flatMap((topic) => topic.groups));
}
