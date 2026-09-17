import { getRequestUser } from "@/lib/auth/request-user";
import { parseTier } from "@/lib/rates/tier";
import { saveAccountTier } from "@/lib/rates/tier-preference";

export const runtime = "nodejs";

// Mémorise le niveau choisi sur le compte connecté, pour les analyses lancées
// depuis un autre appareil. Appelé en arrière-plan par le sélecteur, APRÈS le
// recalcul, qui ne l'attend pas : ce n'est pas un calcul, seulement une
// préférence enregistrée. Sans compte, le cookie écrit par le navigateur suffit.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tier?: unknown } | null;
  const tier = parseTier(body?.tier);
  if (!tier) return Response.json({ error: "Niveau inconnu." }, { status: 400 });
  const user = await getRequestUser(request);
  if (!user) return new Response(null, { status: 204 });
  try {
    const outcome = await saveAccountTier(user.id, tier);
    return outcome === "saved" ? new Response(null, { status: 204 }) : Response.json({ error: "indisponible" }, { status: 503 });
  } catch (caught) {
    console.error(JSON.stringify({ event: "rate_tier_error", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }));
    return Response.json({ error: "indisponible" }, { status: 503 });
  }
}
