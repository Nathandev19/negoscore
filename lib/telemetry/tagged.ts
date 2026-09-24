import { isMissingColumn } from "@/lib/supabase/server";
import { currentEnvironment, type TelemetryEnvironment } from "@/lib/telemetry/environment";

// Mission #103 — écrire une ligne en lui attachant son environnement.
//
// Déploiement descendant-compatible, comme la clé d'idempotence (mission #060)
// et le montant des achats (mission #090) : le code peut précéder la migration
// qui ajoute la colonne. Dans ce cas la ligne s'écrit SANS son environnement
// — elle vaudra « unknown », donc hors production — plutôt que d'échouer
// devant l'utilisateur. Une fois la migration appliquée, ce repli ne sert plus.
//
// Le sens est volontairement prudent : en cas de doute, la ligne n'est jamais
// comptée comme production.
export async function withEnvironment<T>(write: (extra: { environment?: TelemetryEnvironment }) => Promise<T>): Promise<T> {
  try {
    return await write({ environment: currentEnvironment() });
  } catch (caught) {
    if (!isMissingColumn(caught)) throw caught;
    console.warn(JSON.stringify({ event: "telemetry_environment_colonne_absente" }));
    return write({});
  }
}
