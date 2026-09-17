import { hashIp } from "@/lib/security/request";
import { deleteRows, isMissingRelation, rpc, selectRows } from "@/lib/supabase/server";

// Compteur durable des analyses gratuites (migration 015, table free_usage).
// Il survit à la suppression d'une analyse : une gratuité consommée le reste.
// La clé est une empreinte HMAC du jeton anonyme ou de l'identifiant de compte ;
// la ligne ne contient qu'un nombre et une date.
//
// Tant que la migration n'est pas appliquée, la table n'existe pas : les
// fonctions le signalent (`missing`) et l'appelant retombe sur l'ancien
// décompte par deals analysés. Rien ne casse.

export type FreeSubject = { kind: "anon"; token: string } | { kind: "user"; id: string };

export function freeSubjectHash(subject: FreeSubject): string {
  return hashIp(subject.kind === "anon" ? `free-usage:anon:${subject.token}` : `free-usage:user:${subject.id}`);
}

function warnMissing(operation: string) {
  console.warn(JSON.stringify({ event: "free_usage_missing", operation, detail: "Table free_usage absente : appliquer la migration 20260917000015." }));
}

export async function freeUsed(subject: FreeSubject): Promise<number | "missing"> {
  try {
    const [row] = await selectRows<{ used: number }>("free_usage", `select=used&subject_hash=eq.${freeSubjectHash(subject)}&limit=1`);
    return row?.used ?? 0;
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
    warnMissing("read");
    return "missing";
  }
}

// true : l'analyse gratuite est décomptée. false : plafond déjà atteint.
export async function consumeFree(subject: FreeSubject, limit: number): Promise<boolean | "missing"> {
  try {
    return (await rpc<boolean>("free_usage_consume", { p_subject_hash: freeSubjectHash(subject), p_limit: limit })) === true;
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
    warnMissing("consume");
    return "missing";
  }
}

// À la connexion : l'usage gratuit du navigateur suit le compte.
export async function mergeFreeUsage(anonToken: string, userId: string): Promise<void> {
  try {
    await rpc("free_usage_merge", {
      p_from: freeSubjectHash({ kind: "anon", token: anonToken }),
      p_into: freeSubjectHash({ kind: "user", id: userId }),
    });
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
    warnMissing("merge");
  }
}

// Suppression du compte : le compteur du compte disparaît avec lui.
export async function deleteFreeUsage(userId: string): Promise<void> {
  try {
    await deleteRows("free_usage", `subject_hash=eq.${freeSubjectHash({ kind: "user", id: userId })}`);
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
  }
}
