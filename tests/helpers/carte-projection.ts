import { CARTE_COLONNES, CARTE_COLONNES_FIL } from "@/lib/share-card/verdict-data";

// Mission #169 — CE QUE POSTGREST RENDRAIT, ET RIEN DE PLUS.
//
// La route de la carte ne lit que des colonnes projetées. Si un test lui
// passait l'objet complet, il ne vérifierait rien : la route pourrait lire le
// nom de la marque sans que personne s'en aperçoive. Ces fonctions appliquent
// donc la projection à la lettre — un champ absent de la liste auditée vaut
// `undefined`, exactement comme en base.

function lire(racine: Record<string, unknown>, chemin: string): unknown {
  return chemin
    .split(/->>?/)
    .reduce<unknown>((valeur, clef) => (valeur as Record<string, unknown> | null | undefined)?.[clef], racine);
}

function projette(colonnes: readonly string[], racine: Record<string, unknown>, propres: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const colonne of colonnes) {
    const [alias, chemin] = colonne.includes(":") ? colonne.split(/:([\s\S]*)/) : [colonne, null];
    row[alias] = chemin === null ? propres[alias] : lire(racine, chemin);
  }
  return row;
}

/** Une ligne de `analyses` telle que la route la reçoit. */
export function projectionAnalyse(payload: unknown, colonnesPropres: Record<string, unknown> = {}): Record<string, unknown> {
  return projette(CARTE_COLONNES, { payload }, colonnesPropres);
}

/** Une ligne de `negotiation_turns` telle que la route la reçoit. */
export function projectionFil(ligne: {
  kind: "reply" | "conclusion";
  turn_number?: number | null;
  created_at?: string;
  payload: unknown;
}): Record<string, unknown> {
  return projette(CARTE_COLONNES_FIL, { payload: ligne.payload }, {
    kind: ligne.kind,
    turn_number: ligne.turn_number ?? null,
    created_at: ligne.created_at ?? "2026-10-09T00:00:00.000Z",
  });
}
