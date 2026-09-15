import { attachAnonDeals, ensureAccount } from "@/lib/auth/account";
import {
  exchangeCode,
  expiredCookieHeader,
  safeNextPath,
  sessionCookieHeaders,
  VERIFIER_COOKIE,
  verifyTokenHash,
  type Session,
} from "@/lib/auth/session";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

// Retour du magic link. Échange le code (PKCE) ou vérifie le token_hash,
// crée le profil à la première connexion, rattache l'analyse anonyme au
// compte puis efface le cookie anonyme.

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const clearVerifier = expiredCookieHeader(VERIFIER_COOKIE, "/auth");
  const failed = redirect(`/connexion?erreur=lien&next=${encodeURIComponent(next)}`, [clearVerifier]);

  let session: Session | null = null;
  try {
    if (code) {
      const verifier = readCookie(request, VERIFIER_COOKIE);
      if (!verifier) return failed;
      session = await exchangeCode(code, verifier);
    } else if (tokenHash && (type === "magiclink" || type === "email")) {
      session = await verifyTokenHash(tokenHash, type);
    }
    if (!session) return failed;

    await ensureAccount(session.user);
    const anonToken = readCookie(request, ANON_COOKIE);
    const attach = await attachAnonDeals(session.user.id, anonToken);
    console.log(
      JSON.stringify({ event: "auth_callback", attached_deals: attach.attached, attach_refused: attach.refused }),
    );

    const cookies = [...sessionCookieHeaders(session), clearVerifier];
    if (anonToken) cookies.push(expiredCookieHeader(ANON_COOKIE));
    return redirect(next, cookies);
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "auth_callback_error",
        detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu",
      }),
    );
    return failed;
  }
}
