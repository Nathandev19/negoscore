import { describe, expect, it } from "vitest";
import { dealRecapRows, formatEur, formatEurRange } from "@/lib/display";
import { formatEur as formatEurFromMoney } from "@/lib/money";
import { sampleAnalysis } from "@/lib/sample-analysis";

const deal = sampleAnalysis.deal;

describe("affichage des montants", () => {
  it("passe par le formateur unique, séparateur de milliers compris", () => {
    expect(formatEur).toBe(formatEurFromMoney);
    expect(formatEur(1260)).toBe(formatEurFromMoney(1260));
    expect(formatEur(1260).replace(/[\u00a0\u202f]/g, " ")).toBe("1 260 €");
    expect(formatEur(2540).replace(/[\u00a0\u202f]/g, " ")).toBe("2 540 €");
    expect(formatEurRange(1260, 2540)?.replace(/[\u00a0\u202f]/g, " ")).toBe("1 260 € – 2 540 €");
  });

  it("sépare les milliers, y compris sur un montant à quatre chiffres", () => {
    // « 1260 » sans séparateur est le défaut qu'on ne veut plus voir.
    for (const value of [1260, 2540, 7900, 9999]) {
      const formatted = formatEur(value);
      expect(formatted).not.toContain(String(value));
      expect(formatted.replace(/[  ]/g, " ")).toMatch(/^\d \d{3} €$/);
    }
    expect(formatEur(999).replace(/[  ]/g, " ")).toBe("999 €");
  });
});

describe("récap du deal", () => {
  it("capitalise toutes les valeurs de la même façon", () => {
    const rows = dealRecapRows({
      ...deal,
      usage: { ...deal.usage, organic: false, paid_ads: true, duration_months: 12, territory: "tous nos marchés" },
    });
    const usage = rows.find((row) => row.label === "Utilisation");
    const territory = rows.find((row) => row.label === "Territoire");
    expect(usage?.value).toBe("Pub payante · 12 mois");
    expect(territory?.value).toBe("Tous nos marchés");
    for (const row of rows) {
      const first = row.value.charAt(0);
      expect(first, row.label).toBe(first.toUpperCase());
    }
  });
});
