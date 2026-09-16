import { describe, expect, it } from "vitest";
import { displayedPlan, isCancelled, isProActive, periodEndsAt } from "@/lib/billing/plan-access";

const NOW = new Date("2026-09-17T12:00:00.000Z");
const FUTURE = "2026-10-16T05:37:47.007Z";
const PAST = "2026-09-01T05:37:47.007Z";

describe("plan réellement détenu", () => {
  it("un Pro dont la période court est actif", () => {
    const credits = { plan: "pro", balance: 0, period_end: FUTURE } as const;
    expect(isProActive(credits, NOW)).toBe(true);
    expect(displayedPlan(credits, NOW)).toBe("pro");
    expect(periodEndsAt(credits)?.toISOString()).toBe(FUTURE);
  });

  it("un Pro dont la période est passée n'est plus présenté comme Pro", () => {
    expect(isProActive({ plan: "pro", balance: 0, period_end: PAST }, NOW)).toBe(false);
    expect(displayedPlan({ plan: "pro", balance: 0, period_end: PAST }, NOW)).toBe("free");
    // Les crédits achetés séparément restent acquis.
    expect(displayedPlan({ plan: "pro", balance: 2, period_end: PAST }, NOW)).toBe("pack");
  });

  it("un Pro sans date de fin n'est pas actif", () => {
    expect(isProActive({ plan: "pro", balance: 0, period_end: null }, NOW)).toBe(false);
    expect(isProActive({ plan: "pro", balance: 0, period_end: "pas-une-date" }, NOW)).toBe(false);
    expect(periodEndsAt({ period_end: "pas-une-date" })).toBeNull();
  });

  it("les autres plans passent tels quels", () => {
    expect(displayedPlan({ plan: "pack", balance: 3, period_end: null }, NOW)).toBe("pack");
    expect(displayedPlan({ plan: "pack", balance: 0, period_end: null }, NOW)).toBe("free");
    // Des crédits restants ne sont jamais présentés comme un compte gratuit.
    expect(displayedPlan({ plan: "free", balance: 2, period_end: null }, NOW)).toBe("pack");
    expect(displayedPlan({ plan: "free", balance: 0, period_end: null }, NOW)).toBe("free");
    expect(displayedPlan(null, NOW)).toBe("free");
    expect(isProActive(null, NOW)).toBe(false);
  });

  it("repère une résiliation déjà enregistrée", () => {
    expect(isCancelled({ plan: "pro", balance: 0, period_end: FUTURE, cancelled_at: "2026-09-16T05:38:36.000Z" })).toBe(true);
    expect(isCancelled({ plan: "pro", balance: 0, period_end: FUTURE, cancelled_at: null })).toBe(false);
    expect(isCancelled(null)).toBe(false);
  });
});
