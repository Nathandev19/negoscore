import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Mission #201, chantier C — LE PROJET PEUT CLIQUER SES BOUTONS.
//
// Jusqu'ici aucun test ne pouvait en toucher un : pas d'environnement DOM, pas
// de bibliothèque de rendu. Chaque travail d'interface se terminait donc par
// « vérifié à la source », ce qui ne dit rien de ce que fait un clic.
//
// Ce fichier n'est chargé que pour les tests qui le demandent, par la mention
// « @vitest-environment jsdom » en tête de fichier : les 158 autres gardent
// l'environnement Node, qui est plus rapide et qui suffit.

afterEach(() => {
  // Un composant monté par un test ne doit rien laisser derrière lui :
  // sans ça, deux tests qui rendent le même écran se marchent dessus.
  cleanup();
});

// jsdom n'implémente pas matchMedia, que le produit interroge pour le
// mouvement réduit (lib/ui/reveal.ts, prefersReducedMotion). Sans ce bouchon,
// tout composant qui le lit lève une exception au montage.
//
// Valeur par défaut : AUCUNE préférence de mouvement réduit — c'est le cas du
// plus grand nombre. Un test qui veut l'inverse redéfinit la réponse.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// scrollIntoView n'existe pas non plus dans jsdom, et le fil s'en sert pour
// amener l'attente en vue (lib/ui/reveal.ts).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
