import { SupabaseConfigError, SupabaseRequestError } from "@/lib/supabase/server";

function anonConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new SupabaseConfigError("Configuration Supabase absente");
  return { url: url.replace(/\/+$/, ""), anonKey };
}

// Lecture avec la clé anon et le jeton de l'utilisateur : la RLS s'applique.
// À préférer à la clé service_role dès qu'une lecture concerne un compte.
export async function selectRowsAsUser<T>(accessToken: string, table: string, query: string): Promise<T[]> {
  const { url, anonKey } = anonConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new SupabaseRequestError(`lecture ${table} : HTTP ${response.status}`, response.status, null);
  return (await response.json()) as T[];
}

// Mission #181 — COMPTER, toujours sous la même identité. Le compteur de
// l'historique ne peut pas se contenter des lignes lues : la lecture
// s'arrête à 100, et afficher « 100 analyses » à quelqu'un qui en a 140
// serait un chiffre faux à l'écran.
//
// Une requête HEAD, aucune ligne transférée, et la RLS s'applique comme
// partout ailleurs : la personne ne peut compter que les siennes.
export async function countRowsAsUser(accessToken: string, table: string, query: string): Promise<number> {
  const { url, anonKey } = anonConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "HEAD",
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Prefer: "count=exact" },
    cache: "no-store",
  });
  if (!response.ok) throw new SupabaseRequestError(`comptage ${table} : HTTP ${response.status}`, response.status, null);
  const total = response.headers.get("content-range")?.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}
