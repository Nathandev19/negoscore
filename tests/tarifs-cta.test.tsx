import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanCheckoutForm } from "@/components/offers/plan-checkout-form";
import { PLANS } from "@/lib/billing/plans";
import { CONSENT_LINK_LABEL, CONSENT_TEXT } from "@/lib/billing/consent";

describe("CTA des offres payantes", () => {
  const render = (plan: "pack" | "pro", label: string, primary: boolean) =>
    renderToStaticMarkup(<PlanCheckoutForm plan={plan} label={label} primary={primary} />);

  it("rend Pack Deal et Pro comme les mêmes vrais boutons CTA", () => {
    const pack = render("pack", "Prendre Pack Deal", true);
    const pro = render("pro", "Prendre Pro", false);

    for (const [html, label] of [[pack, "Prendre Pack Deal"], [pro, "Prendre Pro"]] as const) {
      expect(html).toContain('action="/api/checkout"');
      expect(html).toContain('method="post"');
      expect(html).toContain(`<button data-slot="button" data-variant="default" data-size="lg"`);
      expect(html).toContain("h-12 w-full text-base");
      expect(html).toContain(`>${label}</button>`);
      expect(html).not.toContain('data-variant="link"');
    }
  });

  it("conserve le plan, le consentement requis et l'état initial interdit", () => {
    for (const plan of ["pack", "pro"] as const) {
      const html = render(plan, plan === "pack" ? "Prendre Pack Deal" : "Prendre Pro", plan === "pack").replace(/&#x27;/g, "'");
      expect(html).toContain(`name="plan" value="${plan}"`);
      expect(html).toContain(`id="consent-${plan}"`);
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('name="consent"');
      expect(html).toContain('required=""');
      expect(html).toContain('aria-disabled="true"');
      expect(html).toContain(CONSENT_LINK_LABEL);
      for (const fragment of CONSENT_TEXT.split(CONSENT_LINK_LABEL)) expect(html).toContain(fragment);
    }
  });

  it("ne change ni prix, ni quota, ni libellé des offres", () => {
    expect(PLANS.map(({ id, name, price, summary }) => ({ id, name, price, summary }))).toMatchInlineSnapshot(`
      [
        {
          "id": "free",
          "name": "Gratuit",
          "price": "0 €",
          "summary": "1 négociation",
        },
        {
          "id": "pack",
          "name": "Pack Deal",
          "price": "4,99 €",
          "summary": "3 négociations complètes",
        },
        {
          "id": "pro",
          "name": "Pro",
          "price": "12,99 €",
          "summary": "Jusqu'à 30 négociations par mois",
        },
      ]
    `);
  });
});
