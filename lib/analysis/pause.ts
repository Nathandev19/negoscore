// Interrupteur de maintenance : ANALYSIS_PAUSED=1 coupe les analyses sans rien
// appeler ni rien décompter. Côté serveur, lu à chaque requête. Côté
// formulaire (pages statiques), la même valeur est copiée au moment du build
// sous NEXT_PUBLIC_ANALYSIS_PAUSED (next.config.ts) : changer la variable
// demande un redéploiement pour que le formulaire l'affiche d'avance.

export const ANALYSIS_PAUSED_MESSAGE =
  "L'analyse est momentanément indisponible. Rien n'est décompté pendant ce temps : réessaie un peu plus tard.";

export function analysisPaused(): boolean {
  return process.env.ANALYSIS_PAUSED === "1";
}
