// Mission #103 — la télémétrie ne compte que la production.
//
// Constaté : le développement local, les déploiements de prévisualisation et
// la suite de tests écrivent dans la même base que la production. Le cockpit
// mélangeait donc trois mondes, et le signal du lancement était illisible.
//
// Règle : le client n'a AUCUNE autorité sur l'environnement. Un champ
// `environment` reçu dans un corps de requête est ignoré, sans erreur — on ne
// donne pas au navigateur un moyen de sonder le comportement. C'est le
// serveur, et lui seul, qui décide, à partir de son propre environnement.
//
// Pas de variable propre au produit (du type NEGOSCORE_ENV) : un interrupteur
// qu'on peut mettre à « production » à la main est exactement le défaut qu'on
// corrige. Pas de détection par le nom d'hôte de la requête non plus.

export const TELEMETRY_ENVIRONMENTS = ["production", "preview", "development", "test", "unknown"] as const;
export type TelemetryEnvironment = (typeof TELEMETRY_ENVIRONMENTS)[number];

// Volontairement réduit à ce qui décide : la fonction reste pure et se teste
// sans muter process.env.
export type EnvironmentSource = {
  VITEST?: string | undefined;
  VERCEL_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
};

export function resolveEnvironment(env: EnvironmentSource): TelemetryEnvironment {
  // La détection de test passe AVANT VERCEL_ENV, volontairement : un test
  // d'intégration lancé avec VERCEL_ENV positionné ne doit pas pouvoir écrire
  // de la « production ».
  if (env.VITEST !== undefined) return "test";
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  if (env.VERCEL_ENV === "development") return "development";
  if (env.NODE_ENV === "test") return "test";
  if (env.NODE_ENV === "development") return "development";
  // Rien ne permet de conclure : « unknown », qui n'est jamais compté comme
  // production. Un doute ne devient pas un chiffre du cockpit.
  return "unknown";
}

// Le seul appelant de process.env : tout écrivain serveur passe par ici.
export function currentEnvironment(): TelemetryEnvironment {
  return resolveEnvironment(process.env);
}
