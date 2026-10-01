import { viewPixelSrc, type MeasuredPage } from "@/lib/analytics/views";

// Mission #120 — la mesure d'une page statique, sans une ligne de JavaScript.
//
// Composant SERVEUR : il ne produit qu'une balise. Le navigateur demande
// l'image en affichant la page, la route l'enregistre (app/api/vue/route.ts),
// et la page reste ce qu'elle était — statique, préchargeable, entière sans
// JavaScript (garantie #074).
//
// Mission #136 — CE N'EST PLUS UNE BALISE <img>, ET C'EST TOUT L'OBJET DE LA
// CORRECTION.
//
// React 19 précharge automatiquement les images rendues côté serveur : il
// ajoute un <link rel="preload" as="image"> dans la page. Dans une charge RSC,
// cette consigne voyage sous la forme :HL["/api/vue?p=…","image"] — vérifié
// dans la réponse de production. Quand Next PRÉCHARGE une page de guide (les
// trois sont dans le pied de page, donc sur tout le site), le navigateur
// applique la consigne AU DOCUMENT COURANT et demande le pixel. La vue était
// enregistrée alors que personne n'avait ouvert le guide, avec le référent de
// la page où l'on se trouvait.
//
// Une image de fond n'a pas ce problème : React ne connaît pas les url() des
// styles, donc aucune consigne de préchargement n'est émise, et le navigateur
// ne demande l'image que s'il rend vraiment l'élément. Un préchargement ne
// rend rien : il ne demande rien.
//
// `aria-hidden` : rien à annoncer à un lecteur d'écran. Hors flux, un pixel,
// transparent : il ne décale pas d'un pixel ce qui est affiché. Surtout pas
// `display:none` ni `visibility:hidden` — un élément qui n'est pas rendu ne
// télécharge pas son fond, et la mesure disparaîtrait.
export function ViewPixel({ page }: { page: MeasuredPage }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute h-px w-px opacity-0"
      style={{ backgroundImage: `url("${viewPixelSrc(page)}")` }}
    />
  );
}
