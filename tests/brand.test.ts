import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Le nom de marque ne doit exister que dans lib/brand.ts.
// Si ce test échoue, remplace la chaîne en dur par BRAND.name.
const WORKING_NAME = "Creator Deal Copilot";
const SCANNED_DIRS = ["app", "components"];

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("brand", () => {
  it(`"${WORKING_NAME}" n'apparaît pas en dur dans app/ et components/`, () => {
    const offenders = SCANNED_DIRS.flatMap((dir) => filesIn(path.join(process.cwd(), dir))).filter(
      (file) => readFileSync(file, "utf8").includes(WORKING_NAME),
    );
    expect(offenders).toEqual([]);
  });
});
