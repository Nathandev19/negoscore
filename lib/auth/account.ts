import type { SessionUser } from "@/lib/auth/session";
import { insertIfAbsent, selectRows, updateRows } from "@/lib/supabase/server";

// Opérations de compte exécutées par le serveur avec la clé service_role.

// Première connexion : profil et ligne de crédits (plan gratuit, solde 0).
// Sans effet si les lignes existent déjà.
export async function ensureAccount(user: SessionUser): Promise<{ created: boolean }> {
  const existing = await selectRows<{ id: string }>("profiles", `select=id&id=eq.${user.id}&limit=1`);
  const created = existing.length === 0;
  await insertIfAbsent("profiles", { id: user.id, email: user.email });
  await insertIfAbsent("credits", { user_id: user.id, balance: 0, plan: "free" });
  return { created };
}

export type AttachResult = { attached: number; refused: boolean };

// Rattache au compte les deals (et donc leurs analyses) créés sous ce jeton
// anonyme. Un jeton dont un deal appartient déjà à un autre compte n'est
// jamais réattribué, même partiellement.
export async function attachAnonDeals(userId: string, anonToken: string | null): Promise<AttachResult> {
  if (!anonToken) return { attached: 0, refused: false };
  const token = encodeURIComponent(anonToken);
  const owned = await selectRows<{ user_id: string | null }>(
    "deals",
    `select=user_id&anon_token=eq.${token}&user_id=not.is.null`,
  );
  if (owned.some((deal) => deal.user_id !== userId)) return { attached: 0, refused: true };
  // Le filtre user_id=is.null rend l'opération sûre face à deux connexions simultanées.
  const rows = await updateRows<{ id: string }>("deals", `anon_token=eq.${token}&user_id=is.null`, { user_id: userId });
  return { attached: rows.length, refused: false };
}
