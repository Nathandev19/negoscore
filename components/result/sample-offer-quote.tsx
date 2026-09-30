import { SAMPLE_OFFER } from "@/lib/fixtures/sample-offer";

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
export function SampleOfferQuote() {
  return (
    <figure className="mb-6 flex flex-col gap-2 sm:mb-8">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-bold tracking-wide text-creme/70 uppercase">Le message reçu</span>
        {/* La mention d'exemple est ICI, au premier contact : quelqu'un qui ne
            lit que ce bloc ne doit pas croire à un vrai deal en cours. Le
            paragraphe complet reste plus bas, sous le bandeau. */}
        <span className="rounded-pill bg-creme/15 px-2 py-0.5 text-xs font-semibold text-creme">
          Exemple — offre inventée
        </span>
      </figcaption>
      <blockquote className="max-w-2xl rounded-control border-l-4 border-creme/50 bg-creme/10 px-4 py-3 text-small text-creme">
        {SAMPLE_OFFER.body}
      </blockquote>
    </figure>
  );
}
