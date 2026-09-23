import { isUuid } from "@/lib/security/request";
import { rpc, selectRows } from "@/lib/supabase/server";

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_PERIODS = ["24h", "7d", "30d", "all"] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];

export function parsePeriod(value: unknown): AdminPeriod {
  return (ADMIN_PERIODS as readonly unknown[]).includes(value) ? (value as AdminPeriod) : "7d";
}

export function sinceForPeriod(period: AdminPeriod, now = new Date()): string | null {
  const hours = period === "24h" ? 24 : period === "7d" ? 7 * 24 : period === "30d" ? 30 * 24 : null;
  return hours === null ? null : new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export type DashboardData = {
  counts: Record<string, number>;
  paid_pro: number;
  granted_pro: number;
  feedback: { total: number; fair: number; not_fair: number };
  purchases: { purchases: number; revenue_eur: number; revenue_covered: number };
  timeseries: Array<{ day: string; page_views: number; analyses: number; signups: number; purchases: number }>;
  acquisition: Array<{ source: string; campaign: string; content: string; visits: number; analyses: number; signups: number; purchases: number }>;
};

const EMPTY_DASHBOARD: DashboardData = {
  counts: {}, paid_pro: 0, granted_pro: 0,
  feedback: { total: 0, fair: 0, not_fair: 0 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [], acquisition: [],
};

export async function loadDashboard(period: AdminPeriod): Promise<DashboardData | "missing"> {
  try {
    return (await rpc<DashboardData>("admin_dashboard_metrics", { p_since: sinceForPeriod(period) })) ?? EMPTY_DASHBOARD;
  } catch {
    return "missing";
  }
}

export type AdminUserRow = {
  id: string; email: string | null; created_at: string; balance: number;
  plan: "free" | "pack" | "pro" | null; period_end: string | null;
  admin_grant: boolean; analyses: number; last_activity: string;
};
export type AdminUsersPage = { total: number; items: AdminUserRow[] };

export async function loadAdminUsers(input: { search?: string; page?: number; sort?: string }): Promise<AdminUsersPage | "missing"> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const sort = ["recent", "email", "analyses", "activity"].includes(input.sort ?? "") ? input.sort : "recent";
  try {
    return await rpc<AdminUsersPage>("admin_users_page", {
      p_search: (input.search ?? "").slice(0, 120), p_offset: (page - 1) * ADMIN_PAGE_SIZE, p_limit: ADMIN_PAGE_SIZE, p_sort: sort,
    });
  } catch {
    return "missing";
  }
}

export type AdminAnalysisRow = {
  id: string; created_at: string; user_id: string | null; email: string | null; score: number | null;
  offered_amount: string | null; estimate_low: string | null; estimate_high: string | null;
  profile_tier: string | null; feedback: string | null; turns: number; concluded: boolean;
};
export type AdminAnalysesPage = { total: number; items: AdminAnalysisRow[] };

export async function loadAdminAnalyses(page = 1): Promise<AdminAnalysesPage | "missing"> {
  try {
    return await rpc<AdminAnalysesPage>("admin_analyses_page", { p_offset: (Math.max(1, page) - 1) * ADMIN_PAGE_SIZE, p_limit: ADMIN_PAGE_SIZE });
  } catch {
    return "missing";
  }
}

export async function loadAdminUserDetail(id: string) {
  if (!isUuid(id)) return null;
  const [profileRows, creditRows, grants, ledger, deals, turns, feedback, events, audit] = await Promise.all([
    selectRows<{ id: string; email: string | null; created_at: string }>("profiles", `select=id,email,created_at&id=eq.${id}&limit=1`),
    selectRows<{ balance: number; plan: string; period_end: string | null; cancelled_at: string | null }>("credits", `select=balance,plan,period_end,cancelled_at&user_id=eq.${id}&limit=1`),
    selectRows<{ id: string; active: boolean; granted_at: string; expires_at: string | null; reason: string | null; revoked_at: string | null }>("admin_entitlements", `select=id,active,granted_at,expires_at,reason,revoked_at&user_id=eq.${id}&order=granted_at.desc&limit=20`).catch(() => []),
    selectRows<{ id: string; delta: number; balance_before: number; balance_after: number; reason: string; occurred_at: string }>("credit_ledger", `select=id,delta,balance_before,balance_after,reason,occurred_at&user_id=eq.${id}&order=occurred_at.desc&limit=50`).catch(() => []),
    selectRows<{ id: string; created_at: string; status: string; analyses: Array<{ id: string; score: number | null }> }>("deals", `select=id,created_at,status,analyses(id,score)&user_id=eq.${id}&order=created_at.desc&limit=50`),
    selectRows<{ id: string; analysis_id: string; kind: "reply" | "conclusion"; turn_number: number | null; created_at: string }>("negotiation_turns", `select=id,analysis_id,kind,turn_number,created_at&user_id=eq.${id}&order=created_at.desc&limit=50`).catch(() => []),
    selectRows<{ analysis_id: string; rating: string; updated_at: string }>("analysis_feedback", `select=analysis_id,rating,updated_at&analysis:analyses!inner(deal:deals!inner(user_id))&analysis.deal.user_id=eq.${id}&order=updated_at.desc&limit=50`).catch(() => []),
    selectRows<{ id: string; event_name: string; occurred_at: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null }>("product_events", `select=id,event_name,occurred_at,utm_source,utm_medium,utm_campaign,utm_content&user_id=eq.${id}&order=occurred_at.desc&limit=50`).catch(() => []),
    selectRows<{ id: string; action: string; reason: string | null; occurred_at: string }>("admin_audit_log", `select=id,action,reason,occurred_at&target_type=eq.user&target_id=eq.${id}&order=occurred_at.desc&limit=50`).catch(() => []),
  ]);
  const profile = profileRows[0];
  if (!profile) return null;
  const now = Date.now();
  const activeGrant = grants.find((grant) => grant.active && (!grant.expires_at || new Date(grant.expires_at).getTime() > now)) ?? null;
  const credits = creditRows[0] ?? null;
  const paid = Boolean(credits?.plan === "pro" && credits.period_end && new Date(credits.period_end).getTime() > now);
  const activityDates = [profile.created_at, ...deals.map((deal) => deal.created_at), ...events.map((event) => event.occurred_at)];
  const lastActivity = activityDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return { profile, credits, grants, activeGrant, paid, ledger, deals, turns, feedback, events, audit, lastActivity };
}
