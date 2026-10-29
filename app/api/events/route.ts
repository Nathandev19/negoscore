import { z } from "zod";
import { entryFor } from "@/lib/lookup";
import { parseAttribution, recordProductEvent } from "@/lib/analytics/first-party";
import { isRobot, refusesTracking } from "@/lib/analytics/robots";
import { TIERS } from "@/lib/rates/tier";
import { DWELL_LABELS, FIRST_ACTION_VALUES, INPUT_TOUCHED, SCROLL_LABELS } from "@/lib/analytics/engagement";

export const runtime = "nodejs";

// Mission #165 — les deux drapeaux de la carte de verdict rejoignent la
// liste : ils sont émis par le navigateur, au clic, et ne portent aucune
// donnée. Comme tier_changed, ils ne nomment pas une page : la garde
// VIEW_PAGES ne les concerne pas.
// Mission #209 — `page_engagement` rejoint la liste. Comme tier_changed, il
// ne nomme pas sa page par son nom d'événement : il en nomme UNE parmi celles
// qui sont mesurées, et c'est ENGAGEMENT_PAGES qui tranche juste en dessous.
const PUBLIC_EVENTS = [
  "landing_view", "pricing_view", "tier_changed", "carte_partagee", "carte_telechargee",
  "page_engagement",
] as const;

// Mission #136 — la page d'où part un événement de vue.
//
// Ces deux-là sont émis par un composant client, dans un useEffect : un
// préchargement ne monte rien, donc ils n'ont jamais eu le défaut du pixel des
// guides (vérifié). Mais rien n'empêchait un corps de déclarer « pricing_view »
// depuis n'importe quelle page. Même règle que partout : l'événement nomme sa
// page, le serveur la vérifie, et un désaccord n'écrit rien.
const VIEW_PAGES: Readonly<Record<string, string>> = { landing_view: "/", pricing_view: "/tarifs" };

// Mission #209 — LES PAGES OÙ LE COMPORTEMENT EN PAGE EST MESURÉ.
//
// Table fermée, même règle que partout : le navigateur ne choisit pas un
// chemin, il choisit une ENTRÉE de cette table. Sans elle, un corps forgé
// créerait des lignes de comportement pour n'importe quelle adresse, et le
// cockpit afficherait des pages qui n'ont jamais été instrumentées.
//
// Il n'y en a qu'UNE, et c'est volontaire : /tiktok-promo n'est pas une page.
// C'est un chemin court qui redirige vers l'accueil en y ajoutant ses UTM
// (lib/acquisition/chemins.ts, proxy.ts). Instrumenter « /tiktok-promo et
// l'accueil » revient donc à instrumenter l'accueil une seule fois ; le
// payant se distingue par utm_medium, déjà enregistré.
export const ENGAGEMENT_PAGES = ["/"] as const;

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
// Mission #209 — le relevé de comportement, champ par champ, chacun dans son
// vocabulaire fermé. Les listes viennent de lib/analytics/engagement.ts : une
// borne qui change là-bas change ici, et la base refuse tout le reste
// (contrainte product_events_engagement_metadata_check, migration 42).
//
// `strict()` et non le comportement par défaut : une clé inattendue dans CE
// sous-objet doit faire REFUSER le corps, pas être retirée en silence. Le
// cockpit agrège ces clés — une clé de plus serait une catégorie invisible,
// et une clé mal nommée un compteur muet.
const engagementSchema = z
  .object({
    scroll: z.enum(SCROLL_LABELS),
    dwell: z.enum(DWELL_LABELS),
    first_action: z.enum(FIRST_ACTION_VALUES),
    input: z.enum(INPUT_TOUCHED),
    scrolled: z.boolean(),
  })
  .strict()
  // Un défilement EST un geste : le relevé lève les deux drapeaux au même
  // endroit (lib/analytics/engagement.ts). « a défilé » sans premier geste
  // décrirait une mesure cassée, et la compter donnerait un chiffre faux dans
  // l'outil même qui sert à ne plus supposer.
  .refine((v) => !v.scrolled || v.first_action !== "aucun", {
    message: "un défilement sans geste est impossible",
  });

export const bodySchema = z.object({
  event: z.enum(PUBLIC_EVENTS),
  tier: z.enum(TIERS).optional(),
  engagement: engagementSchema.optional(),
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
  // Mission #209 — un relevé de comportement sans relevé, ou sur une page qui
  // n'est pas mesurée, n'écrit rien. La réponse ne change pas d'un octet : le
  // client n'apprend pas ce qui a été fait de sa requête, même règle que les
  // deux gardes au-dessus.
  if (parsed.data.event === "page_engagement") {
    const mesurable = ENGAGEMENT_PAGES.some((page) => page === attribution.path);
    if (!mesurable || !parsed.data.engagement) {
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
  }
  await recordProductEvent({
    event: parsed.data.event,
    attribution,
    entityType: niveau ? "niveau" : null,
    entityId: niveau,
    // Le relevé ne voyage QUE pour son événement : aucun autre ne peut
    // déposer de métadonnées par cette route.
    metadata: parsed.data.event === "page_engagement" ? parsed.data.engagement : undefined,
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
