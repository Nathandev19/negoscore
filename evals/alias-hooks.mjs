import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Résout l'alias « @/ » du tsconfig pour les scripts d'éval exécutés par Node,
// et ajoute l'attribut JSON attendu par Node aux imports de fichiers .json.
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = path.join(ROOT, specifier.slice(2));
    const candidates = [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")];
    const found = candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith(path.sep));
    if (found) {
      const url = pathToFileURL(found).href;
      if (found.endsWith(".json")) {
        return { url, format: "json", importAttributes: { type: "json" }, shortCircuit: true };
      }
      return nextResolve(url, context);
    }
  }
  return nextResolve(specifier, context);
}
