import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountSummary } from "@/lib/account/summary";
import { accessSource, grantPeriod, type AdminGrant } from "@/lib/billing/access";

const state = vi.hoisted(() => ({
  session: null as { id: string; email: string } | null | "unavailable",
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => state.session));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return fn === "admin_adjust_credits"
        ? { balance_before: 2, balance_after: 5, delta: 3 }
        : { active: true, source: "admin_grant" };
    },
  };
});

const OWNER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@negoscore.test" };
const USER = { id: "22222222-2222-4222-8222-222222222222", email: "user@negoscore.test" };
const TARGET = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "admin-request-0001";
const context = { params: Promise.resolve({ id: TARGET }) };

function request(pathname: string, body: unknown, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${pathname}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", OWNER.email);
  state.session = null;
  state.rpcCalls = [];
});

afterEach(() => vi.unstubAllEnvs());

describe("autorisation et mutations du cockpit", () => {
  const entitlement = async (body: unknown, origin?: string) => {
    const { POST } = await import("@/app/api/admin/users/[id]/entitlement/route");
    return POST(request(`/api/admin/users/${TARGET}/entitlement`, body, origin), context);
  };
  const credits = async (body: unknown, origin?: string) => {
    const { POST } = await import("@/app/api/admin/users/[id]/credits/route");
    return POST(request(`/api/admin/users/${TARGET}/credits`, body, origin), context);
  };

  it("refuse la personne déconnectée avant toute mutation", async () => {
    expect((await entitlement({})).status).toBe(401);
    expect((await credits({})).status).toBe(401);
    expect(state.rpcCalls).toEqual([]);
  });

  it("refuse un compte normal et une auth indisponible", async () => {
    state.session = USER;
    expect((await entitlement({})).status).toBe(403);
    state.session = "unavailable";
    expect((await credits({})).status).toBe(503);
    expect(state.rpcCalls).toEqual([]);
  });

  it("refuse le cross-origin et les entrées invalides, même pour l'admin", async () => {
    state.session = OWNER;
    expect((await credits({ delta: 3, reason: "support", requestId: REQUEST_ID }, "https://evil.test")).status).toBe(403);
    expect((await credits({ delta: -3, reason: "x", requestId: "court" })).status).toBe(400);
    expect((await entitlement({ action: "grant", reason: "support", requestId: REQUEST_ID, expiresAt: "2020-01-01" })).status).toBe(400);
    expect(state.rpcCalls).toEqual([]);
  });

  it("l'admin appelle uniquement les RPC atomiques avec acteur, motif et clé d'idempotence", async () => {
    state.session = OWNER;
    const grant = await entitlement({ action: "grant", reason: "Partenariat", requestId: REQUEST_ID, expiresAt: null });
    const adjust = await credits({ delta: 3, reason: "Geste support", requestId: "admin-request-0002" });
    expect(grant.status).toBe(200);
    expect(adjust.status).toBe(200);
    expect(state.rpcCalls).toEqual([
      { fn: "admin_set_pro_grant", args: { p_actor: OWNER.id, p_user: TARGET, p_action: "grant", p_expires_at: null, p_reason: "Partenariat", p_request_id: REQUEST_ID } },
      { fn: "admin_adjust_credits", args: { p_actor: OWNER.id, p_user: TARGET, p_delta: 3, p_reason: "Geste support", p_idempotency_key: "admin-request-0002" } },
    ]);
  });
});

describe("abonnement payant et accès offert restent deux sources distinctes", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");
  const grant: AdminGrant = { id: "g1", source: "admin_grant", granted_at: "2026-09-20T12:00:00.000Z", expires_at: "2026-10-20T12:00:00.000Z" };
  const paid = { plan: "pro", balance: 0, period_end: "2026-10-23T12:00:00.000Z" } as const;
  const expired = { plan: "pro", balance: 0, period_end: "2026-09-01T12:00:00.000Z" } as const;

  it("le grant actif donne Pro et reste explicitement un accès offert", () => {
    expect(accessSource(expired, grant, now)).toBe("admin_grant");
    expect(accountSummary(expired, now, grant)).toMatchObject({ plan: "pro", planLabel: "Pro — accès offert", canCancel: false, accessSource: "admin_grant" });
  });

  it("l'abonnement réel prime ; retirer le grant laisse donc Pro", () => {
    expect(accessSource(paid, grant, now)).toBe("subscription");
    expect(accessSource(paid, null, now)).toBe("subscription");
    expect(accountSummary(paid, now, null)).toMatchObject({ plan: "pro", planLabel: "Pro", canCancel: true });
  });

  it("un grant expiré ne donne plus Pro et sa période est bornée", () => {
    const old = { ...grant, expires_at: "2026-09-22T12:00:00.000Z" };
    expect(accessSource(expired, old, now)).toBe("free");
    expect(grantPeriod(grant, now)).toEqual({ start: new Date("2026-09-20T12:00:00.000Z"), end: now });
  });
});

describe("migration admin : transactions, audit, idempotence et confinement", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20260923000030_admin_cockpit.sql"), "utf8").toLowerCase();

  it("crée les quatre tables privées avec RLS et index utiles", () => {
    for (const table of ["admin_entitlements", "credit_ledger", "admin_audit_log", "product_events"]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("revoke all on table public.admin_entitlements, public.credit_ledger, public.admin_audit_log, public.product_events from anon, authenticated");
    for (const index of ["admin_entitlements_user_active_idx", "credit_ledger_user_time_idx", "admin_audit_target_time_idx", "product_events_name_time_idx", "product_events_time_idx", "product_events_acquisition_time_idx", "analysis_feedback_updated_idx", "purchases_paid_idx", "analyses_created_idx"]) expect(sql).toContain(index);
  });

  it("ajuste le solde sous verrou, refuse le négatif, écrit ledger et audit dans la même fonction", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.admin_adjust_credits"), sql.indexOf("create or replace function public.admin_dashboard_metrics"));
    for (const proof of ["for update", "new_balance < 0", "insert into public.credit_ledger", "insert into public.admin_audit_log", "where idempotency_key = p_idempotency_key", "if found then return previous"]) expect(fn).toContain(proof);
  });

  it("rend l'audit append-only jusque dans la base", () => {
    expect(sql).toContain("create trigger admin_audit_append_only_trigger");
    expect(sql).toContain("before update or delete on public.admin_audit_log");
    expect(sql).toContain("raise exception 'admin audit log is append-only'");
  });

  it("le grant ne touche jamais au plan payant et chaque RPC est service_role seulement", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.admin_set_pro_grant"), sql.indexOf("create or replace function public.admin_adjust_credits"));
    expect(fn).not.toMatch(/update public\.credits|insert into public\.credits/);
    expect(fn).toContain("insert into public.admin_audit_log");
    expect(sql).toContain("grant execute on function public.admin_set_pro_grant");
    expect(sql).toContain("grant execute on function public.admin_adjust_credits");
    expect(sql).toContain("to service_role");
  });

  it("la page utilisateur distingue visuellement les deux Pro", () => {
    const paidHtml = renderToStaticMarkup(<span>PRO — SUBSCRIPTION</span>);
    const grantHtml = renderToStaticMarkup(<span>PRO — ADMIN GRANT</span>);
    expect(paidHtml).not.toBe(grantHtml);
  });

  it("confine le graphique large dans son propre scroll sur mobile", () => {
    const dashboard = readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    const charts = readFileSync(path.join(process.cwd(), "components/admin/charts.tsx"), "utf8");
    expect(charts).toContain('className="overflow-x-auto"');
    expect(charts).toContain('className="min-w-[640px] w-full"');
    expect(dashboard).toContain('className="min-w-0 border-t-4 border-marque pt-4"');
  });
});
