"use client";

import { useId, useState } from "react";
import { SAMPLE_OFFER } from "@/lib/fixtures/sample-offer";
import { WITH_JS_ONLY } from "@/lib/no-js";


// Mission #125 — le message reçu, au-dessus du verdict.
//
// La page d'exemple montrait un chiffre sans son entrée : « 300 € proposés,
// ces droits en valent 430 à 900 » est une AFFIRMATION tant que le message qui
// l'a produite n'est pas là. Avec lui, c'est une démonstration — et c'est
// exactement la promesse du produit : je lis l'offre, je la chiffre.
//
// Rendu dans le bandeau bleu, juste avant le score, parce que c'est l'ordre de
// la vraie vie : on reçoit le message, PUIS on veut savoir ce qu'il vaut.
//
// Tenu court à dessein : sur un téléphone, ce bloc pousse le score vers le bas.
// La consigne de la mission est claire — raccourcir le message, jamais le
// résultat. C'est le corps de l'offre, sans la signature
// (lib/fixtures/sample-offer.ts dit pourquoi).
//
// ───────────────────────────────────────────────────────────────────────────
// Mission #148 — SOUS 400 px, LE BLOC SE REPLIE.
//
// Les créatrices n'arrivent pas ici depuis Chrome : elles arrivent du
// navigateur intégré d'Instagram, qui pose une barre en haut et une en bas et
// retire 120 à 150 px de hauteur utile. Ce bloc, entier, repoussait le bouton
// « Analyser mon offre » sous la ligne de flottaison sur les petits écrans.
//
// Le texte n'est NI raccourci NI réécrit : c'est toujours SAMPLE_OFFER.body,
// d'un seul tenant, dans un seul nœud. On le replie à trois lignes, et le
// déplier le rend identique au mot près. Au-dessus de 400 px, rien ne change :
// ni repli, ni contrôle — le bouton est en display:none, donc hors du parcours
// clavier.
//
// Sans JavaScript : le contrôle ne pourrait rien déplier, il est donc masqué
// (WITH_JS_ONLY), et le repli lui-même est annulé par la règle
// `html:not([data-js]) [data-replie]` de globals.css. Le message reste lisible
// en entier — la garantie #074 ne perd rien.

// Largeur en dessous de laquelle le bloc se replie. Écrite ici ET dans les
// variantes Tailwind ci-dessous (`min-[400px]:`), qui n'acceptent pas une
// constante : tests/exemple-chiffre.test.tsx vérifie que les deux concordent.
export const SEUIL_REPLI_PX = 400;

export function SampleOfferQuote() {
  const [deplie, setDeplie] = useState(false);
  const citationId = useId();
  return (
    <figure className="mb-6 flex flex-col gap-2 sm:mb-8">
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-bold tracking-wide text-creme/70 uppercase">Le message reçu</span>
        {/* La mention d'exemple est ICI, au premier contact : quelqu'un qui ne
            lit que ce bloc ne doit pas croire à un vrai deal en cours. Le
            paragraphe complet reste plus bas, sous le bandeau. */}
        <span className="rounded-pill bg-creme/15 px-2 py-0.5 text-xs font-semibold text-creme">
          Exemple — offre inventée
        </span>
        {/* Mission #148 — le contrôle est DANS cette ligne, pas sous la
            citation. Posé dessous, il coûtait 44 px de cible tactile plus
            l'espacement : exactement ce que le repli venait de gagner, et à
            375 × 560 il faisait repasser le bouton sous la ligne de
            flottaison. Ici il tient dans une ligne qui existe déjà. */}
        <button
          {...WITH_JS_ONLY}
          type="button"
          onClick={() => setDeplie((etat) => !etat)}
          aria-expanded={deplie}
          aria-controls={citationId}
          className="rounded-pill px-2 py-0.5 text-xs font-semibold text-creme underline decoration-2 underline-offset-2 min-[400px]:hidden"
        >
          {deplie ? "Masquer le message" : "Voir le message complet"}
        </button>
      </figcaption>
      <blockquote
        id={citationId}
        // Lu par globals.css sans JavaScript, pour annuler le repli.
        data-replie={deplie ? undefined : ""}
        // Concaténation simple, PAS cn() : tailwind-merge ne connaît pas
        // l'utilitaire maison `text-small` et le prend pour une couleur, donc
        // `text-creme` l'effaçait — la citation changeait de taille.
        className={`max-w-2xl rounded-control border-l-4 border-creme/50 bg-creme/10 px-4 py-3 text-small text-creme${
          deplie ? "" : " line-clamp-3 min-[400px]:line-clamp-none"
        }`}
      >
        {SAMPLE_OFFER.body}
      </blockquote>
    </figure>
  );
}
