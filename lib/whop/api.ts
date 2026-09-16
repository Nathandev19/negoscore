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

export type WhopMembership = {
  id: string;
  status: string | null;
  cancel_at_period_end: boolean | null;
  renewal_period_end: string | null;
};

function membershipFrom(body: unknown): WhopMembership | null {
  const row = body as Partial<WhopMembership> | null;
  if (!row?.id) return null;
  return {
    id: row.id,
    status: row.status ?? null,
    cancel_at_period_end: row.cancel_at_period_end ?? null,
    renewal_period_end: row.renewal_period_end ?? null,
  };
}

async function membershipRequest(path: string, init: RequestInit): Promise<WhopMembership | null> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new WhopConfigError("Clé API Whop absente");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "whop_membership_error", path, status: response.status }));
    return null;
  }
  return membershipFrom(await response.json());
}

// État d'un abonnement. Docs : https://docs.whop.com/api-reference/memberships/retrieve-membership
export function getMembership(id: string): Promise<WhopMembership | null> {
  return membershipRequest(`/memberships/${encodeURIComponent(id)}`, { method: "GET" });
}

// Annulation à la fin de la période en cours.
// Docs : https://docs.whop.com/api-reference/memberships/cancel-membership
// POST /memberships/{id}/cancel, body { cancellation_mode: "at_period_end" }.
// Permissions requises sur la clé : membership:cancel, member:basic:read, member:email:read.
export function cancelMembershipAtPeriodEnd(id: string): Promise<WhopMembership | null> {
  return membershipRequest(`/memberships/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ cancellation_mode: "at_period_end" }),
  });
}
