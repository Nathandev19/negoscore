import { z } from "zod";
import { parseAttribution, recordProductEvent } from "@/lib/analytics/first-party";

export const runtime = "nodejs";

const PUBLIC_EVENTS = ["landing_view", "pricing_view"] as const;

// Mission #103 — ce que le navigateur a le droit d'envoyer, et rien d'autre.
// Schéma STRIPPANT (comportement par défaut de zod) : un champ inattendu du
// corps — à commencer par `environment` — est retiré ici et n'atteint jamais
// l'insert. Il n'y a par ailleurs aucun étalement d'objet issu du corps dans
// l'écriture : `recordProductEvent` construit sa ligne champ par champ, et
// l'environnement y est décidé par le serveur (lib/telemetry/environment.ts).
//
// Un `environment` reçu est donc ignoré SANS erreur : on ne donne pas au
// client un moyen de sonder le comportement en comparant les réponses.
export const bodySchema = z.object({
  event: z.enum(PUBLIC_EVENTS),
  attribution: z.unknown().optional(),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  let trustedOrigin = false;
  try {
    trustedOrigin = Boolean(origin) && new URL(origin as string).origin === new URL(request.url).origin;
  } catch {
    trustedOrigin = false;
  }
  if (!trustedOrigin || (site && site !== "same-origin")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid event" }, { status: 400 });
  }
  await recordProductEvent({ event: parsed.data.event, attribution: parseAttribution(parsed.data.attribution) });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
