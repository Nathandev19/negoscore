import { adminAccess, adminError, sameOrigin } from "@/lib/admin/access";
import { isUuid } from "@/lib/security/request";
import { rpc } from "@/lib/supabase/server";

export const runtime = "nodejs";
const KEY = /^[A-Za-z0-9_-]{16,100}$/;

export async function POST(request: Request, { params }: RouteContext<"/api/admin/users/[id]/credits">) {
  const access = await adminAccess(request);
  if (!access.ok) return adminError(access);
  if (!sameOrigin(request)) return Response.json({ error: "csrf" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const delta = body?.delta;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!isUuid(id) || !Number.isInteger(delta) || Number(delta) === 0 || Math.abs(Number(delta)) > 100000 || reason.length < 2 || reason.length > 500 || !KEY.test(requestId)) {
    return Response.json({ error: "invalid input" }, { status: 400 });
  }
  try {
    const result = await rpc("admin_adjust_credits", {
      p_actor: access.user.id, p_user: id, p_delta: delta, p_reason: reason, p_idempotency_key: requestId,
    });
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "admin_credits_error", detail: error instanceof Error ? error.message.slice(0, 160) : "inconnu" }));
    return Response.json({ error: "mutation failed" }, { status: 503 });
  }
}
