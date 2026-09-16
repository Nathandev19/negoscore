"use server";

import { cookies, headers } from "next/headers";
import { newPkcePair, safeNextPath, sendMagicLink, VERIFIER_COOKIE } from "@/lib/auth/session";
import { hashIp } from "@/lib/security/request";
import { configuredSiteUrl, originFromHeaders } from "@/lib/site-url";
import { hitUsageGuard } from "@/lib/security/usage-guard";

export type LoginState = { status: "idle" | "sent" | "error"; message: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKS_PER_HOUR = 5;

export async function requestMagicLink(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!EMAIL.test(email) || email.length > 254) {
    return { status: "error", message: "Cet email ne semble pas valide." };
  }

  const requestHeaders = await headers();
  const origin = configuredSiteUrl() ?? originFromHeaders(requestHeaders);
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip") || "local";

  try {
    const guard = await hitUsageGuard(hashIp(`magic-link:${ip}`), { limit: LINKS_PER_HOUR });
    if (!guard.allowed) {
      return { status: "error", message: `Trop de demandes de lien. Réessaie dans ${guard.retryInMinutes} min.` };
    }

    const { verifier, challenge } = newPkcePair();
    (await cookies()).set(VERIFIER_COOKIE, verifier, {
      path: "/auth",
      maxAge: 60 * 15,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const sent = await sendMagicLink(email, challenge, redirectTo);
    if (!sent) {
      return { status: "error", message: "Le lien n'a pas pu être envoyé. Réessaie dans quelques minutes." };
    }
    return { status: "sent", message: `C'est parti : ouvre le lien envoyé à ${email}. Il est valable une heure.` };
  } catch {
    return { status: "error", message: "La connexion n'est pas disponible pour le moment. Réessaie plus tard." };
  }
}
