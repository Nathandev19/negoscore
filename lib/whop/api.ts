// Client Whop côté serveur. Docs : https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration

const API_BASE = "https://api.whop.com/api/v1";
const CHECKOUT_BASE = "https://whop.com";

export type PlanKey = "pack" | "pro";

export class WhopConfigError extends Error {}

export function planId(plan: PlanKey): string {
  const value = plan === "pack" ? process.env.WHOP_PLAN_PACK : process.env.WHOP_PLAN_PRO;
  if (!value) throw new WhopConfigError(`Identifiant de plan Whop absent (${plan})`);
  return value;
}

// Plan Whop → offre interne. Sert à interpréter les webhooks.
export function planKeyFromId(id: string | null | undefined): PlanKey | null {
  if (!id) return null;
  if (id === process.env.WHOP_PLAN_PACK) return "pack";
  if (id === process.env.WHOP_PLAN_PRO) return "pro";
  return null;
}

export function fallbackCheckoutUrl(plan: PlanKey): string {
  return `${CHECKOUT_BASE}/checkout/${planId(plan)}`;
}

// Crée une configuration de checkout portant l'identifiant du compte en
// metadata : le webhook le relit dans data.metadata. Renvoie null si l'appel
// échoue, pour que l'appelant retombe sur le lien de paiement simple.
export async function createCheckoutUrl(options: {
  plan: PlanKey;
  metadata: Record<string, string>;
  redirectUrl: string;
}): Promise<{ url: string; checkoutConfigurationId: string } | null> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch(`${API_BASE}/checkout_configurations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: planId(options.plan),
        metadata: options.metadata,
        redirect_url: options.redirectUrl,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "whop_checkout_error", status: response.status }));
      return null;
    }
    const body = (await response.json()) as { id?: string; purchase_url?: string };
    if (!body.id) return null;
    const path = body.purchase_url ?? `/checkout/${body.id}/`;
    return { url: `${CHECKOUT_BASE}${path.startsWith("/") ? path : `/${path}`}`, checkoutConfigurationId: body.id };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "whop_checkout_error", detail: error instanceof Error ? error.message.slice(0, 200) : "inconnu" }),
    );
    return null;
  }
}
