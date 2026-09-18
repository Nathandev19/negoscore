"use server";

import { cookies, headers } from "next/headers";
import { newPkcePair, safeNextPath, sendMagicLink, VERIFIER_COOKIE } from "@/lib/auth/session";
import { CLAIM_PARAM, createLoginClaim } from "@/lib/auth/login-claims";
import { ANON_COOKIE, hashIp } from "@/lib/security/request";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { hitUsageGuard } from "@/lib/security/usage-guard";

// next : la destination retenue, rendue avec l'état pour que l'écran « lien
// envoyé » la garde aussi après un envoi sans JavaScript (mission #074).
export type LoginState = { status: "idle" | "sent" | "error"; message: string | null; email?: string; next?: string };

// Destination demandée. Avec JavaScript, le champ caché « next » la porte.
// Sans JavaScript, la page statique n'a pas pu lire son adresse : le champ est
// absent, et l'on prend ?next= dans l'adresse de la page qui a envoyé le
// formulaire (en-tête Referer), du même site uniquement. Filtrée ensuite par
// safeNextPath comme toute destination.
function requestedNext(formData: FormData, referer: string | null, origin: string): string {
  const field = formData.get("next");
  if (typeof field === "string" && field !== "") return safeNextPath(field);
  if (!referer) return safeNextPath(null);
  try {
    const page = new URL(referer);
    if (page.origin !== new URL(origin).origin) return safeNextPath(null);
    return safeNextPath(page.searchParams.get("next"));
  } catch {
    return safeNextPath(null);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKS_PER_HOUR = 5;

export async function requestMagicLink(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const requestHeaders = await headers();
  const origin = configuredSiteUrl() ?? originFromHeaders(requestHeaders);
  const next = requestedNext(formData, requestHeaders.get("referer"), origin);
  if (!EMAIL.test(email) || email.length > 254) {
    return { status: "error", message: "Cet email ne semble pas valide.", next };
  }

  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip") || "local";

  try {
    const guard = await hitUsageGuard(hashIp(`magic-link:${ip}`), { limit: LINKS_PER_HOUR });
    if (!guard.allowed) {
      return { status: "error", message: `Trop de demandes de lien. Réessaie dans ${guard.retryInMinutes} min.`, next };
    }

    const { verifier, challenge } = newPkcePair();
    const jar = await cookies();
    jar.set(VERIFIER_COOKIE, verifier, {
      path: "/auth",
      maxAge: 60 * 15,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    // Mission #067 : ce navigateur porte un jeton anonyme, donc peut-être une
    // analyse faite sans compte. La réclamation est enregistrée MAINTENANT,
    // pendant qu'on est dans le bon navigateur, et son secret part dans le
    // lien : ouvert ailleurs, le lien rattachera quand même ces analyses.
    // Le jeton est lu dans le cookie httpOnly, jamais reçu du formulaire.
    const anonToken = jar.get(ANON_COOKIE)?.value ?? null;
    const claim = anonToken ? await createLoginClaim(email, anonToken) : null;
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}${claim ? `&${CLAIM_PARAM}=${claim}` : ""}`;
    const sent = await sendMagicLink(email, challenge, redirectTo);
    if (!sent) {
      return { status: "error", message: "Le lien n'a pas pu être envoyé. Réessaie dans quelques minutes.", next };
    }
    return { status: "sent", message: null, email, next };
  } catch {
    return { status: "error", message: "La connexion n'est pas disponible pour le moment. Réessaie plus tard.", next };
  }
}
