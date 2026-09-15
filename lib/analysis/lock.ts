import type { Analysis } from "@/lib/schema";

// Champs réservés aux utilisateurs connectés propriétaires de l'analyse.
export const LOCKED_FIELDS = ["counter_offer", "ready_to_send_message"] as const;
type LockedField = (typeof LOCKED_FIELDS)[number];

export type ResultView = Omit<Analysis, LockedField> & Partial<Pick<Analysis, LockedField>>;

// Retire physiquement les champs verrouillés : ils ne sont ni rendus, ni
// sérialisés, ni envoyés au navigateur.
export function lockAnalysis(analysis: Analysis): ResultView {
  const view: Partial<Analysis> = { ...analysis };
  for (const field of LOCKED_FIELDS) delete view[field];
  return view as ResultView;
}
