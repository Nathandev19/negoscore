import type { SessionUser } from "@/lib/auth/session";
import { sameToken } from "@/lib/security/request";
import { isMissingColumn, selectRows } from "@/lib/supabase/server";

// Clé d'idempotence d'une analyse (mission #060).
//
// Le navigateur tire une clé AVANT d'envoyer sa demande et la garde tant qu'il
// n'a pas affiché de résultat. S'il rejoue — coupure réseau, onglet fermé,
// bouton pressé une seconde fois — la même clé revient, et le serveur rend
// l'analyse déjà produite au lieu d'en lancer une autre. Sans ce verrou, une
// requête interrompue après coup consommait le droit et laissait le navigateur
// sans identifiant : l'analyse était perdue pour un visiteur sans compte.
//
// La clé n'est jamais une autorisation : elle ne sert qu'à retrouver une
// analyse DÉJÀ rattachée au demandeur. Une clé présentée par quelqu'un d'autre
// ne rend rien (voir `replayableAnalysis`).

// 16 à 100 caractères, alphabet d'un UUID ou d'un jeton base64url.
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,100}$/;

export function readIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && KEY_SHAPE.test(value) ? value : null;
}

type Owner = { user: SessionUser | null; anonToken: string | null };

type DealRow = {
  id: string;
  user_id: string | null;
  anon_token: string | null;
  analyses: Array<{ id: string }>;
};

export type Replay =
  | { kind: "none" }
  // Analyse déjà produite pour cette clé, par ce demandeur : on la rend.
  | { kind: "analysis"; analysisId: string }
  // Clé déjà employée par quelqu'un d'autre, ou demande restée sans analyse :
  // on ne rend rien et on n'écrit pas la clé, l'analyse repart normalement.
  | { kind: "taken" };

function owns(row: DealRow, owner: Owner): boolean {
  if (row.user_id !== null) return owner.user !== null && row.user_id === owner.user.id;
  return sameToken(row.anon_token, owner.anonToken);
}

// Analyse déjà produite pour cette clé. `none` tant que la colonne n'existe
// pas (migration 019 non appliquée) : le comportement reste celui d'avant.
export async function replayableAnalysis(key: string, owner: Owner): Promise<Replay> {
  let rows: DealRow[];
  try {
    rows = await selectRows<DealRow>(
      "deals",
      `select=id,user_id,anon_token,analyses(id)&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`,
    );
  } catch (caught) {
    if (!isMissingColumn(caught)) throw caught;
    console.warn(JSON.stringify({ event: "idempotency_column_absente" }));
    return { kind: "none" };
  }
  const row = rows[0];
  if (!row) return { kind: "none" };
  if (!owns(row, owner)) return { kind: "taken" };
  const analysis = row.analyses[0];
  return analysis ? { kind: "analysis", analysisId: analysis.id } : { kind: "taken" };
}
