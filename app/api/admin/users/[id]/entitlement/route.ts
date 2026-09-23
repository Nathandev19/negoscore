import { adminAccess, adminError, sameOrigin } from "@/lib/admin/access";
import { isUuid } from "@/lib/security/request";
import { rpc } from "@/lib/supabase/server";

export const runtime = "nodejs";
const KEY = /^[A-Za-z0-9_-]{16,100}$/;

export async function POST(request: Request, { params }: RouteContext<"/api/admin/users/[id]/entitlement">) {
  const access = await adminAccess(request);
  if (!access.ok) return adminError(access);
  if (!sameOrigin(request)) return Response.json({ error: "csrf" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const expiresAt = body?.expiresAt === null || body?.expiresAt === "" ? null : typeof body?.expiresAt === "string" ? body.expiresAt : "invalid";
  if (!isUuid(id) || (action !== "grant" && action !== "revoke") || reason.length < 2 || reason.length > 500 || !KEY.test(requestId)) {
    return Response.json({ error: "invalid input" }, { status: 400 });
  }
  if (expiresAt && (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    return Response.json({ error: "invalid expiry" }, { status: 400 });
  }
  try {
    const result = await rpc("admin_set_pro_grant", {
      p_actor: access.user.id, p_user: id, p_action: action, p_expires_at: expiresAt, p_reason: reason, p_request_id: requestId,
    });
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "admin_entitlement_error", detail: error instanceof Error ? error.message.slice(0, 160) : "inconnu" }));
    return Response.json({ error: "mutation failed" }, { status: 503 });
  }
}
