import { analysisSchema, type Analysis } from "@/lib/schema";

// La dernière analyse vit dans le sessionStorage du navigateur, le temps
// d'afficher la page de résultat. Rien n'est stocké côté serveur.
const KEY = "last-analysis";

export function saveAnalysis(analysis: Analysis): void {
  sessionStorage.setItem(KEY, JSON.stringify(analysis));
}

export function readStoredAnalysis(): string | null {
  return sessionStorage.getItem(KEY);
}

export function parseStoredAnalysis(raw: string | null): Analysis | null {
  if (!raw) return null;
  try {
    const result = analysisSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
