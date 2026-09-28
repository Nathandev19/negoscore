import { viewPixelSrc, type MeasuredPage } from "@/lib/analytics/views";

// Mission #120 — la mesure d'une page statique, sans une ligne de JavaScript.
//
// Composant SERVEUR : il ne produit qu'une balise. Le navigateur demande
// l'image en chargeant la page, la route l'enregistre (app/api/vue/route.ts),
// et la page reste ce qu'elle était — statique, préchargeable, entière sans
// JavaScript (garantie #074).
//
// `alt` vide et aria-hidden : rien à annoncer à un lecteur d'écran, et rien à
// lire pour qui affiche la page sans images. Positionné hors flux et
// transparent : il ne décale pas d'un pixel ce qui est affiché.
export function ViewPixel({ page }: { page: MeasuredPage }) {
  // next/image optimiserait, préchargerait et mettrait en cache l'image :
  // exactement les trois choses qui empêcheraient de compter une vue. C'est
  // donc une balise <img> nue, et elle le restera.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={viewPixelSrc(page)}
      alt=""
      aria-hidden="true"
      width={1}
      height={1}
      decoding="async"
      className="pointer-events-none absolute h-px w-px opacity-0"
    />
  );
}
