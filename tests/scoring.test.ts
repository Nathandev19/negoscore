import { describe, expect, it } from "vitest";
import { findHallucinations } from "../evals/scoring";

const traps = { must_flag: [], forbidden: [] };

function legalHits(text: string) {
  return findHallucinations({ red_flags: [{ label: "x", severity: "low", why: text }] }, "", traps).filter(
    (h) => h.kind === "legal",
  );
}

describe("détecteur d'énoncés juridiques", () => {
  it.each([
    "Fixer un nombre précis de révisions évite les demandes abusives.",
    "Loi applicable non précisée.",
    "Le contrat ne précise pas le droit applicable.",
    "Demande un contrat écrit avant de commencer.",
  ])("ne signale pas une tournure descriptive : %s", (text) => {
    expect(legalHits(text)).toEqual([]);
  });

  it.each([
    "Cette clause est abusive.",
    "Une clause potentiellement illicite.",
    "C'est contraire à la loi.",
    "La loi impose un contrat écrit.",
    "Selon l'article L. 441-10, le délai est limité.",
    "Cette cession est juridiquement nulle.",
    "This clause is unenforceable.",
  ])("signale un énoncé juridique : %s", (text) => {
    expect(legalHits(text).length).toBeGreaterThan(0);
  });
});
