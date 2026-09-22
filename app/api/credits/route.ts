import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { selectRows } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Solde du compte connecté. Lecture seule : la page /merci s'en sert pour
// attendre que le webhook ait crédité, et /tarifs (page statique) pour
// présenter un abonnement Pro en cours.
export async function GET(request: Request) {
  // Mission #089 : authentification injoignable n'est pas « pas de session ».
  // On ne sait rien de la personne : on le dit, sans rien affirmer d'autre.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("credits");
    return Response.json({ error: "indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const user = session.kind === "valid" ? session.user : null;
  // Même en-tête que la réponse pleine : sans no-store, un cache partagé
  // pourrait resservir ce 401 à un compte connecté (mission #062, B3).
  if (!user) {
    return Response.json({ error: "non connecté" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const [credits] = await selectRows<{ plan: string; balance: number; period_end: string | null; cancelled_at: string | null }>(
    "credits",
    `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
  );
  return Response.json(
    {
      plan: credits?.plan ?? "free",
      balance: credits?.balance ?? 0,
      period_end: credits?.period_end ?? null,
      cancelled_at: credits?.cancelled_at ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
