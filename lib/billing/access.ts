import { isProActive, type PlanState } from "@/lib/billing/plan-access";
import { isMissingRelation, selectRows } from "@/lib/supabase/server";

export type AdminGrant = { id: string; granted_at: string; expires_at: string | null; source: "admin_grant" };
export type AccessSource = "free" | "pack" | "subscription" | "admin_grant";

export async function activeAdminGrant(userId: string, now = new Date()): Promise<AdminGrant | null> {
  try {
    const [grant] = await selectRows<AdminGrant>(
      "admin_entitlements",
      `select=id,granted_at,expires_at,source&user_id=eq.${userId}&entitlement=eq.pro&source=eq.admin_grant&active=is.true&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now.toISOString())})&order=granted_at.desc&limit=1`,
    );
    return grant?.source === "admin_grant" && typeof grant.id === "string" && typeof grant.granted_at === "string" ? grant : null;
  } catch (caught) {
    if (isMissingRelation(caught)) return null;
    throw caught;
  }
}

export function accessSource(credits: PlanState | null, grant: AdminGrant | null, now = new Date()): AccessSource {
  if (isProActive(credits, now)) return "subscription";
  if (grant && (!grant.expires_at || new Date(grant.expires_at).getTime() > now.getTime())) return "admin_grant";
  return (credits?.balance ?? 0) > 0 ? "pack" : "free";
}

export function grantPeriod(grant: AdminGrant, now = new Date()): { start: Date; end: Date } {
  const rollingStart = new Date(now);
  rollingStart.setMonth(rollingStart.getMonth() - 1);
  const granted = new Date(grant.granted_at);
  return { start: granted.getTime() > rollingStart.getTime() ? granted : rollingStart, end: now };
}
