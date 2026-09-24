import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hasProAccess, hasReserve, isGrantedPro, offerAction, type AccountView, type PlanState } from "@/lib/billing/plan-access";
import { RECHARGE_ACTION, RECHARGE_FEATURES, SIGN_IN_TO_PAY, takePlan } from "@/lib/content/vocabulaire";

// Mission #111 — la page Tarifs doit savoir ce que le compte possède déjà.
//
// Constaté en production le 24/09, sur deux comptes ayant réellement acheté un
// Pack Deal : la page affichait « Prendre Pack Deal », comme s'ils n'avaient
// rien. Et un accès Pro OFFERT par l'administrateur se voyait proposer
// « Prendre Pro », faute de period_end à lire.

const DANS_UN_MOIS = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const HIER = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

const compte = (over: Partial<PlanState>): PlanState => ({
  plan: "free",
  balance: 0,
  period_end: null,
  cancelled_at: null,
  access_source: "free",
  ...over,
});

const PACK = compte({ plan: "pack", balance: 3, access_source: "pack" });
const GRATUIT = compte({});
const PRO_PAYE = compte({ plan: "pro", period_end: DANS_UN_MOIS, access_source: "subscription" });
const PRO_OFFERT = compte({ plan: "pro", period_end: null, access_source: "admin_grant" });
const PRO_EXPIRE = compte({ plan: "pro", period_end: HIER, access_source: "free" });

describe("ce que le compte possède déjà", () => {
  it("des négociations en réserve : le solde fait foi", () => {
    expect(hasReserve(PACK)).toBe(true);
    expect(hasReserve(GRATUIT)).toBe(false);
    expect(hasReserve(null)).toBe(false);
    // Un Pro expiré qui garde des négociations en a toujours en réserve.
    expect(hasReserve({ ...PRO_EXPIRE, balance: 2 })).toBe(true);
  });

  it("un accès Pro en cours : payé et actif, OU offert par l'administrateur", () => {
    expect(hasProAccess(PRO_PAYE)).toBe(true);
    expect(hasProAccess(PRO_OFFERT)).toBe(true);
    expect(hasProAccess(PRO_EXPIRE)).toBe(false);
    expect(hasProAccess(PACK)).toBe(false);
    expect(hasProAccess(null)).toBe(false);
  });

  it("un accès offert se distingue d'un abonnement payé", () => {
    expect(isGrantedPro(PRO_OFFERT)).toBe(true);
    expect(isGrantedPro(PRO_PAYE)).toBe(false);
    expect(isGrantedPro(PACK)).toBe(false);
  });
});

describe("ce que la page propose, formule par formule", () => {
  const pour = (account: AccountView) => ({
    pack: offerAction("pack", account),
    pro: offerAction("pro", account),
    free: offerAction("free", account),
  });

  it("compte sans négociation en réserve : « Prendre Pack Deal »", () => {
    expect(pour(GRATUIT)).toEqual({ pack: "acheter", pro: "acheter", free: null });
  });

  it("compte avec des négociations en réserve : « Recharger »", () => {
    expect(pour(PACK).pack).toBe("recharger");
    // Il peut toujours prendre l'abonnement : il ne l'a pas.
    expect(pour(PACK).pro).toBe("acheter");
  });

  it("compte Pro actif : aucune action d'achat de Pro, et le Pack en recharge", () => {
    expect(pour(PRO_PAYE)).toEqual({ pack: "recharger", pro: "formule_en_cours", free: null });
  });

  it("compte Pro OFFERT par l'administrateur : même comportement qu'un Pro payé", () => {
    expect(pour(PRO_OFFERT)).toEqual(pour(PRO_PAYE));
    expect(pour(PRO_OFFERT).pro).toBe("formule_en_cours");
  });

  it("abonnement expiré : il redevient achetable, et le solde restant se recharge", () => {
    expect(pour(PRO_EXPIRE).pro).toBe("acheter");
    expect(pour({ ...PRO_EXPIRE, balance: 2 }).pack).toBe("recharger");
    expect(pour(PRO_EXPIRE).pack).toBe("acheter");
  });

  it("visiteur non connecté : « Se connecter pour payer »", () => {
    expect(pour("visiteur")).toEqual({ pack: "connexion", pro: "connexion", free: null });
  });

  it("compte pas encore lu : AUCUNE des quatre actions", () => {
    const actions = pour("inconnu");
    expect(actions).toEqual({ pack: "attente", pro: "attente", free: null });
    for (const action of [actions.pack, actions.pro]) {
      expect(["acheter", "recharger", "connexion", "formule_en_cours"]).not.toContain(action);
    }
  });

  it("compte illisible : on le dit, sans bouton", () => {
    expect(pour("illisible")).toEqual({ pack: "illisible", pro: "illisible", free: null });
  });
});

// ─── Ce que l'écran rend vraiment ───────────────────────────────────────────

describe("la page Tarifs rendue", () => {
  // Le rendu statique n'exécute ni effet ni fetch : useSyncExternalStore y rend
  // son instantané SERVEUR, qui vaut toujours « pas encore lu ». C'est
  // exactement l'état qu'on veut vérifier ici ; les autres sont couverts par la
  // décision pure ci-dessus, et par les assertions de source qui suivent.
  const render = async () => {
    const { OffersList } = await import("@/components/offers/offers-list");
    return renderToStaticMarkup(<OffersList />);
  };

  it("premier rendu, avant toute lecture : aucune des quatre actions", async () => {
    const html = await render();
    expect(html).not.toContain(takePlan("Pro"));
    expect(html).not.toContain(takePlan("Pack Deal"));
    expect(html).not.toContain(RECHARGE_ACTION);
    expect(html).not.toContain(SIGN_IN_TO_PAY);
    expect(html).toContain("data-pending-purchase");
    expect(html).toContain('aria-busy="true"');
  });

  it("les prix et les contenus restent affichés pendant l'attente", async () => {
    const html = await render();
    expect(html).toContain("4,99");
    expect(html).toContain("12,99");
  });
});

describe("le composant ne redécide rien de son côté", () => {
  const source = readFileSync(new URL("../components/offers/offers-list.tsx", import.meta.url), "utf8");

  it("les trois libellés viennent tous de la décision unique", () => {
    expect(source).toContain('const action = offerAction(plan.id, account);');
    expect(source).toContain('const asRecharge = action === "recharger";');
    expect(source).toContain('const isCurrentPro = action === "formule_en_cours";');
    expect(source).toContain('action === "attente"');
    expect(source).toContain('action === "acheter" || action === "recharger"');
  });

  it("aucune phrase visible n'est écrite dans le composant", () => {
    for (const phrase of ["Recharger", "Prendre ", "Se connecter pour payer", "Ta formule en cours"]) {
      const code = source
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      expect(code, phrase).not.toContain(`"${phrase}`);
    }
  });
});

describe("la copie de la recharge", () => {
  it("dit la vérité dans les deux cas, et ne parle jamais de crédits", () => {
    expect(RECHARGE_FEATURES.pro[0]).toContain("quota mensuel");
    // Quelqu'un qui a des négociations en réserve n'a pas de quota mensuel :
    // la phrase du Pro serait fausse pour lui.
    expect(RECHARGE_FEATURES.reserve.join(" ")).not.toContain("quota");
    for (const feature of [...RECHARGE_FEATURES.pro, ...RECHARGE_FEATURES.reserve]) {
      expect(feature.toLowerCase()).not.toContain("crédit");
    }
  });
});
