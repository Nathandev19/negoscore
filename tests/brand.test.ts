import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Le nom de marque ne doit exister que dans lib/brand.ts.
// Si ce test échoue, remplace la chaîne en dur par BRAND.name.
const FORBIDDEN_NAMES = [
  "Negoscore",
  // Ancien nom de travail, assemblé ici pour ne pas apparaître en clair dans le repo.
  ["Creator", "Deal", "Copilot"].join(" "),
];
const SCANNED_DIRS = ["app", "components"];

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("brand", () => {
  const files = SCANNED_DIRS.flatMap((dir) => filesIn(path.join(process.cwd(), dir)));

  it.each(FORBIDDEN_NAMES)("%s n'apparaît pas en dur dans app/ et components/", (name) => {
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").toLowerCase().includes(name.toLowerCase()),
    );
    expect(offenders).toEqual([]);
  });
});
