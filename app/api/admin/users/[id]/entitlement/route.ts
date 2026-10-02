import { adminAccess, adminError, sameOrigin } from "@/lib/admin/access";
import { instantDepuisParis } from "@/lib/admin/heure";
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
  // Mission #146 — la valeur reçue est une heure MURALE DE PARIS, pas un
  // instant. Le champ est un datetime-local : il n'envoie aucun fuseau. Avant,
  // elle partait telle quelle vers la base, qui la lisait en UTC — une
  // échéance saisie « 23:59 » tombait à 01:59 le lendemain à Paris en été.
  // On la convertit ici, et c'est un INSTANT qui est écrit.
  const saisie = body?.expiresAt === null || body?.expiresAt === "" ? null : typeof body?.expiresAt === "string" ? body.expiresAt : "invalide";
  const expiresAt = saisie === null ? null : instantDepuisParis(saisie);
  if (!isUuid(id) || (action !== "grant" && action !== "revoke") || reason.length < 2 || reason.length > 500 || !KEY.test(requestId)) {
    return Response.json({ error: "invalid input" }, { status: 400 });
  }
  // Une valeur donnée mais illisible est refusée : on n'enregistre jamais un
  // accès sans échéance à la place d'une échéance qu'on n'a pas su lire.
  if (saisie !== null && (expiresAt === null || expiresAt.getTime() <= Date.now())) {
    return Response.json({ error: "invalid expiry" }, { status: 400 });
  }
  try {
    const result = await rpc("admin_set_pro_grant", {
      p_actor: access.user.id, p_user: id, p_action: action, p_expires_at: expiresAt === null ? null : expiresAt.toISOString(),
      p_reason: reason, p_request_id: requestId,
    });
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "admin_entitlement_error", detail: error instanceof Error ? error.message.slice(0, 160) : "inconnu" }));
    return Response.json({ error: "mutation failed" }, { status: 503 });
  }
}
