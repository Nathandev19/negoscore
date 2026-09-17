import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS, PRICE, PRO_PERIOD } from "@/lib/billing/plans";

// Mission #049 — un prix n'existe qu'à un seul endroit : lib/billing/plans.ts.
// Une somme en euros avec des centimes écrite ailleurs dans le code affiché
// (page, composant, email, CGV) fait échouer ce test. Les montants des offres
// de marques n'en ont pas : ils viennent des analyses, jamais du code.
const SOURCE = "lib/billing/plans.ts";
const AMOUNT = /\d+[.,]\d{2}\s*(?:€|EUR\b)/;

function sourceFiles(): string[] {
  return ["app", "components", "lib"].flatMap((dir) =>
    readdirSync(path.join(process.cwd(), dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.relative(process.cwd(), path.join(entry.parentPath, entry.name)).replaceAll("\\", "/")),
  );
}

describe("prix affichés", () => {
  it("aucune somme en euros écrite en dur hors de la source unique", () => {
    const offenders = sourceFiles()
      .filter((file) => file !== SOURCE)
      .flatMap((file) =>
        readFileSync(path.join(process.cwd(), file), "utf8")
          .split("\n")
          .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
          .filter(({ text }) => AMOUNT.test(text)),
      );
    expect(offenders, offenders.map((o) => `${o.file}:${o.line} ${o.text}`).join("\n")).toEqual([]);
  });

  // Page de résiliation : elle annonçait « 12,99 € par mois » en dur (#048).
  // Le texte affiché doit rester identique au caractère près.
  it("la page de résiliation affiche toujours le même tarif", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { CancelView } = await import("@/components/account/cancel-view");
    const html = renderToStaticMarkup(
      CancelView({
        data: {
          // Abonnement en cours : c'est la seule variante qui affiche le tarif.
          credits: { plan: "pro", balance: 0, period_end: "2099-01-01T00:00:00.000Z", cancelled_at: null },
          error: null,
          forDeletion: false,
          etat: null,
        },
      }),
    );
    expect(html.replace(/\s+/g, " ").replace(/&#x27;/g, "'")).toContain("Abonnement Pro — 12,99 € par mois");
  });

  it("les prix vendus n'ont pas changé", () => {
    expect(PRICE).toEqual({ free: "0 €", pack: "4,99 €", pro: "12,99 €" });
    expect(PRO_PERIOD).toBe("par mois");
    expect(PLANS.map((plan) => `${plan.name} ${plan.price}${plan.period ? ` ${plan.period}` : ""}`)).toEqual([
      "Gratuit 0 €",
      "Pack Deal 4,99 €",
      "Pro 12,99 € par mois",
    ]);
  });
});
