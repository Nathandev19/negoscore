import { cache } from "react";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, userFromAccessToken, type SessionUser } from "@/lib/auth/session";

// Utilisateur connecté d'une page serveur, vérifié auprès de Supabase Auth.

// Mémorisé par requête (mission #049) : le layout d'une page de résultat décide
// le 404 avant tout rendu, puis la page relit le même visiteur. Sans ce cache,
// chaque affichage demanderait deux fois la session à Supabase.
export const getViewer = cache(async function getViewer(): Promise<SessionUser | null> {
  return userFromAccessToken((await cookies()).get(ACCESS_COOKIE)?.value);
});

export async function getViewerAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}
