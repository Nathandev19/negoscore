// Grain posé sur les surfaces bleues du site : un bruit SVG inline, sans image
// bitmap ni requête réseau (app/globals.css, utilitaire `grain`, tuile de
// 180 px). La carte partageable n'en a pas : voir lib/share-card/element.tsx. Cohérence vérifiée par tests/design.test.ts.
//
// Opacité maximale du bruit. Les contrastes sur bleu sont calculés au pire cas :
// un pixel du bleu mélangé à 6 % de blanc pur (le plus clair possible) ou de
// noir pur (le plus foncé).
export const GRAIN_OPACITY = 0.06;

export function grainSvg(width: number, height: number): string {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>` +
    "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>" +
    "<feColorMatrix type='saturate' values='0'/></filter>" +
    `<rect width='100%' height='100%' filter='url(#g)' opacity='${GRAIN_OPACITY}'/></svg>`
  );
}

// Data URI utilisable en CSS comme dans une balise <img> : « % » et « # »
// échappés (satori décode l'URI avec decodeURIComponent, un « % » nu la casse).
export function grainDataUri(width: number, height: number): string {
  return `data:image/svg+xml,${grainSvg(width, height).replace(/%/g, "%25").replace(/#/g, "%23")}`;
}

export const GRAIN_TILE = 180;
