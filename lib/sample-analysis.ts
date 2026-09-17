import { composeAnalysis } from "@/lib/analysis/compose";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { extractionSchema } from "@/lib/llm/prompt";
import type { Analysis } from "@/lib/schema";

// Exemple figé de l'accueil et de /analyse/demo. Seule la part écrite par le
// modèle est enregistrée (lib/fixtures/sample-extraction.json : deal extrait,
// points, red flags, message) ; tout ce que le moteur calcule (fourchette,
// libellés, score, verdict, contre-offre, repères juridiques, version du
// schéma) est recalculé au rendu. L'exemple montre donc toujours ce qu'une
// analyse d'aujourd'hui produirait (mission #037). Vérifié par
// tests/fixtures-current.test.ts.
export const sampleAnalysis: Analysis = composeAnalysis(extractionSchema.parse(sampleExtraction));
