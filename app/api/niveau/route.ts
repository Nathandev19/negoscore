import { getRequestUser } from "@/lib/auth/request-user";
import { parseTier } from "@/lib/rates/tier";
import { saveAccountTier } from "@/lib/rates/tier-preference";

export const runtime = "nodejs";

// Mémorise le niveau choisi sur le compte connecté, pour les analyses lancées
// depuis un autre appareil. Appelé en arrière-plan par le sélecteur, APRÈS le
// recalcul, qui ne l'attend pas : ce n'est pas un calcul, seulement une
// préférence enregistrée. Sans compte, le cookie écrit par le navigateur suffit.
//
// Mission #065 : appelé à chaque changement de niveau d'une personne connectée,
// quelle que soit l'analyse ouverte (le niveau est une préférence de personne),
// avec le moment du choix (`at`, en millisecondes) : le plus récent gagne.
// Chaque issue autre qu'un enregistrement est journalisée ; le navigateur, lui,
// ne montre rien, et son cookie reste la référence.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tier?: unknown; at?: unknown } | null;
  const tier = parseTier(body?.tier);
  if (!tier) {
    console.warn(JSON.stringify({ event: "rate_tier_rejected", reason: "niveau inconnu" }));
    return Response.json({ error: "Niveau inconnu." }, { status: 400 });
  }
  const at = typeof body?.at === "number" && Number.isFinite(body.at) && body.at > 0 ? body.at : Date.now();
  const user = await getRequestUser(request);
  if (!user) return new Response(null, { status: 204 });
  try {
    const outcome = await saveAccountTier(user.id, tier, at);
    if (outcome === "missing") return Response.json({ error: "indisponible" }, { status: 503 });
    if (outcome === "stale") {
      // Un choix plus récent est déjà sur le compte : rien à faire, ce n'est pas une erreur.
      console.log(JSON.stringify({ event: "rate_tier_stale", tier }));
    }
    return new Response(null, { status: 204 });
  } catch (caught) {
    console.error(JSON.stringify({ event: "rate_tier_error", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }));
    return Response.json({ error: "indisponible" }, { status: 503 });
  }
}
