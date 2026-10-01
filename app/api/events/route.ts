import { z } from "zod";
import { entryFor } from "@/lib/lookup";
import { parseAttribution, recordProductEvent } from "@/lib/analytics/first-party";
import { isRobot, refusesTracking } from "@/lib/analytics/robots";
import { TIERS } from "@/lib/rates/tier";

export const runtime = "nodejs";

const PUBLIC_EVENTS = ["landing_view", "pricing_view", "tier_changed"] as const;

// Mission #136 — la page d'où part un événement de vue.
//
// Ces deux-là sont émis par un composant client, dans un useEffect : un
// préchargement ne monte rien, donc ils n'ont jamais eu le défaut du pixel des
// guides (vérifié). Mais rien n'empêchait un corps de déclarer « pricing_view »
// depuis n'importe quelle page. Même règle que partout : l'événement nomme sa
// page, le serveur la vérifie, et un désaccord n'écrit rien.
const VIEW_PAGES: Readonly<Record<string, string>> = { landing_view: "/", pricing_view: "/tarifs" };

// Mission #130 — le niveau vient du navigateur, mais il ne peut valoir que
// l'une des trois entrées de TIERS. Même règle que partout ailleurs : le
// client ne choisit pas une valeur, il choisit une ENTRÉE d'une table
// fermée. Un niveau inconnu fait refuser le corps entier.

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
  tier: z.enum(TIERS).optional(),
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
  // Mission #120 — le moteur de rendu de Google exécute le JavaScript de la
  // page : sans ce filtre, chaque exploration comptait comme une visite sur
  // l'accueil et sur /tarifs. Écarté ici comme sur /api/vue, et la réponse ne
  // change pas d'un octet : le client n'apprend rien de ce qui a été fait.
  //
  // Le refus de suivi est lu côté SERVEUR en plus du navigateur : le composant
  // client vérifie navigator.doNotTrack, ce qui ne couvre que les visiteurs qui
  // ont JavaScript. La page de confidentialité promet mieux que ça.
  if (isRobot(request.headers.get("user-agent")) || refusesTracking(request.headers)) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  const attribution = parseAttribution(parsed.data.attribution);
  // Mission #136 — une vue qui ne vient pas de sa page n'est pas une vue. La
  // réponse ne change pas d'un octet : le client n'apprend rien de ce qui a
  // été fait de sa requête.
  const attendue = entryFor(VIEW_PAGES, parsed.data.event);
  if (attendue !== undefined && attribution.path !== attendue) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  // Le niveau consulté voyage dans entity_type/entity_id, les deux colonnes
  // prévues pour ça : aucune nouvelle colonne, aucun champ libre.
  const niveau = parsed.data.event === "tier_changed" ? (parsed.data.tier ?? null) : null;
  await recordProductEvent({
    event: parsed.data.event,
    attribution,
    entityType: niveau ? "niveau" : null,
    entityId: niveau,
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
