// Client Whop côté serveur. Docs : https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration

const API_BASE = "https://api.whop.com/api/v1";
const CHECKOUT_BASE = "https://whop.com";
// Whop versionne son API par date. Sans cet en-tête, les requêtes repartent
// dans les formes du 2025-01-01, où `cancellation_mode` n'existe pas : la
// résiliation devient immédiate au lieu de prendre effet en fin de période.
// Docs : https://docs.whop.com/api-reference/beta/overview
const API_VERSION_DATE = "2026-08-21-1";

function whopHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Api-Version-Date": API_VERSION_DATE,
  };
}

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

// Page de paiement d'une configuration déjà créée (mission #071) : la même
// adresse que purchase_url, reconstruite depuis l'identifiant.
export function checkoutUrlForConfiguration(configurationId: string): string {
  return `${CHECKOUT_BASE}/checkout/${encodeURIComponent(configurationId)}/`;
}

// Mission #112 — il n'y a PLUS de lien de paiement de secours. Une page de
// paiement sans identifiant de compte encaisse de l'argent que le webhook ne
// saura rattacher qu'à une adresse email, c'est-à-dire pas du tout de façon
// sûre : avec Apple Pay, l'adresse de l'acheteur n'est pas celle du compte.
// Si la session ne peut pas être créée avec l'identifiant, le paiement
// n'ouvre pas (app/api/checkout/route.ts).

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
      headers: whopHeaders(apiKey),
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
    // Whop renvoie purchase_url en absolu (https://whop.com/checkout/ch_xxx/).
    // On ne préfixe que si la valeur est relative, sinon l'URL est doublée.
    const target = body.purchase_url ?? `/checkout/${body.id}/`;
    const url = /^https?:\/\//i.test(target)
      ? target
      : `${CHECKOUT_BASE}${target.startsWith("/") ? target : `/${target}`}`;
    return { url, checkoutConfigurationId: body.id };
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
  // Mission #114 — les metadata dont l'abonnement a hérité de la session de
  // paiement. Docs Whop, checkout configurations : « Payments and memberships
  // created from a checkout session inherit its metadata. » C'est là que se
  // trouve l'identifiant du compte quand un RENOUVELLEMENT ne le porte pas.
  metadata: Record<string, unknown>;
};

function membershipFrom(body: unknown): WhopMembership | null {
  const row = body as (Partial<WhopMembership> & { metadata?: unknown }) | null;
  if (!row?.id) return null;
  return {
    id: row.id,
    status: row.status ?? null,
    cancel_at_period_end: row.cancel_at_period_end ?? null,
    renewal_period_end: row.renewal_period_end ?? null,
    metadata: typeof row.metadata === "object" && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {},
  };
}

async function membershipRequest(path: string, init: RequestInit): Promise<WhopMembership | null> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new WhopConfigError("Clé API Whop absente");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...whopHeaders(apiKey), ...init.headers },
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

// Mission #114 — LA LECTURE D'UN ABONNEMENT, EN TROIS ÉTATS.
//
// getMembership rend null aussi bien quand Whop répond « cet abonnement
// n'existe pas » que quand Whop ne répond pas du tout. Pour décider de
// créditer un compte, ces deux réponses ne se valent pas : la première est un
// fait, la seconde est une ignorance. Même règle que la mission #089 bis sur
// l'authentification — une indisponibilité n'est pas une absence.
export type MembershipRead =
  | { kind: "found"; membership: WhopMembership }
  // Whop a répondu, et cet abonnement n'existe pas ou n'est pas lisible.
  | { kind: "absent" }
  // Whop n'a pas pu répondre : réseau, 5xx, clé absente, corps illisible.
  | { kind: "unavailable"; detail: string };

export async function readMembership(id: string): Promise<MembershipRead> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return { kind: "unavailable", detail: "cle_absente" };
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/memberships/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: whopHeaders(apiKey),
      cache: "no-store",
    });
  } catch (error) {
    return { kind: "unavailable", detail: error instanceof Error ? error.message.slice(0, 120) : "reseau" };
  }
  // 404 et 410 : Whop a répondu, cet abonnement n'existe pas. Tout le reste
  // (401, 429, 5xx) : on ne sait pas, et on ne devine pas.
  if (response.status === 404 || response.status === 410) return { kind: "absent" };
  if (!response.ok) return { kind: "unavailable", detail: `http_${response.status}` };
  const body = await response.json().catch(() => null);
  const membership = membershipFrom(body);
  return membership ? { kind: "found", membership } : { kind: "unavailable", detail: "corps_illisible" };
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
