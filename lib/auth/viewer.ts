import { cache } from "react";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, AuthUnavailableError, sessionFromAccessToken, type SessionUser } from "@/lib/auth/session";

// Utilisateur connecté d'une page serveur, vérifié auprès de Supabase Auth.

// Mémorisé par requête (mission #049) : le layout d'une page de résultat décide
// le 404 avant tout rendu, puis la page relit le même visiteur. Sans ce cache,
// chaque affichage demanderait deux fois la session à Supabase.
//
// Mission #089 — Supabase Auth injoignable : on ne sait rien de la session.
// Plutôt que de répondre « pas connectée » (redirection vers /connexion,
// analyse « introuvable »), la page lève AuthUnavailableError : la page
// d'erreur dit « réessaie dans un instant », ce qui est vrai.
export const getViewer = cache(async function getViewer(): Promise<SessionUser | null> {
  const check = await sessionFromAccessToken((await cookies()).get(ACCESS_COOKIE)?.value);
  if (check.kind === "unavailable") {
    console.warn(JSON.stringify({ event: "auth_unavailable", route: "page" }));
    throw new AuthUnavailableError();
  }
  return check.kind === "valid" ? check.user : null;
});

export async function getViewerAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}
