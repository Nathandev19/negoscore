import { isOwner } from "@/lib/admin/owner";
import { getRequestSession } from "@/lib/auth/request-user";
import type { SessionUser } from "@/lib/auth/session";

export type AdminAccess =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403 | 503; reason: "signed_out" | "forbidden" | "unavailable" };

export async function adminAccess(request: Request): Promise<AdminAccess> {
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") return { ok: false, status: 503, reason: "unavailable" };
  if (session.kind !== "valid") return { ok: false, status: 401, reason: "signed_out" };
  if (!isOwner(session.user)) return { ok: false, status: 403, reason: "forbidden" };
  return { ok: true, user: session.user };
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function adminError(access: Exclude<AdminAccess, { ok: true }>): Response {
  return Response.json({ error: access.reason }, { status: access.status, headers: { "Cache-Control": "no-store" } });
}
