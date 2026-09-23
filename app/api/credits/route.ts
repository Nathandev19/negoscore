import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { recentPurchases } from "@/lib/billing/purchases";
import { selectRows } from "@/lib/supabase/server";
import { activeAdminGrant, accessSource } from "@/lib/billing/access";

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
  // Mission #090 : ce qui vient d'être acheté, pour la page « Merci ». Lu ici
  // parce que la page interroge cette route toutes les deux secondes en
  // attendant le webhook.
  const purchases = await recentPurchases(user.id).catch(() => "unavailable" as const);
  const [[credits], grant] = await Promise.all([
    selectRows<{ plan: "free" | "pack" | "pro"; balance: number; period_end: string | null; cancelled_at: string | null }>(
      "credits", `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
    ),
    activeAdminGrant(user.id),
  ]);
  const source = accessSource(credits ?? null, grant);
  return Response.json(
    {
      plan: source === "subscription" || source === "admin_grant" ? "pro" : (credits?.plan ?? "free"),
      access_source: source,
      balance: credits?.balance ?? 0,
      period_end: credits?.period_end ?? null,
      // null : aucun achat récent. undefined (champ absent) : on ne sait pas.
      ...(purchases === "unavailable" ? {} : { purchase: purchases.last, duplicates: purchases.duplicates, analyses_added: purchases.analysesAdded }),
      cancelled_at: credits?.cancelled_at ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
