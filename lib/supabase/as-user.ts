import { SupabaseConfigError, SupabaseRequestError } from "@/lib/supabase/server";

// Lecture avec la clé anon et le jeton de l'utilisateur : la RLS s'applique.
// À préférer à la clé service_role dès qu'une lecture concerne un compte.
export async function selectRowsAsUser<T>(accessToken: string, table: string, query: string): Promise<T[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new SupabaseConfigError("Configuration Supabase absente");
  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${table}?${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new SupabaseRequestError(`lecture ${table} : HTTP ${response.status}`, response.status, null);
  return (await response.json()) as T[];
}
