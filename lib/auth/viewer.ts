import { cache } from "react";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, AuthUnavailableError, sessionFromAccessToken, type SessionCheck, type SessionUser } from "@/lib/auth/session";
import { sessionState, type SessionState } from "@/lib/auth/session-state";

// Utilisateur connecté d'une page serveur, vérifié auprès de Supabase Auth.

// Mémorisé par requête (mission #049) : le layout d'une page de résultat décide
// le 404 avant tout rendu, puis la page relit le même visiteur. Sans ce cache,
// chaque affichage demanderait deux fois la session à Supabase.
//
// Mission #089 — Supabase Auth injoignable : on ne sait rien de la session.
// Plutôt que de répondre « pas connectée » (redirection vers /connexion,
// analyse « introuvable »), la page lève AuthUnavailableError : la page
// d'erreur dit « réessaie dans un instant », ce qui est vrai.
// Un seul appel à Supabase par requête, quel que soit le nombre de lectures.
const readSession = cache(async function readSession(): Promise<SessionCheck> {
  return sessionFromAccessToken((await cookies()).get(ACCESS_COOKIE)?.value);
});

// Mission #089 bis — les trois états, sans jamais lever. Pour les pages qui
// savent afficher « l'authentification ne répond pas » elles-mêmes, plutôt que
// de laisser la page d'erreur générique dire « cette page n'a pas pu
// s'afficher » — vrai, mais muet sur la cause et sur le fait qu'il n'y a rien
// à refaire. L'utilisateur reste null sur « indisponible » : c'est l'ÉTAT qui
// doit être lu avant lui, jamais l'inverse.
export async function getViewerState(): Promise<{ state: SessionState; user: SessionUser | null }> {
  const check = await readSession();
  const state = sessionState(check);
  if (state === "indisponible") console.warn(JSON.stringify({ event: "auth_unavailable", route: "page" }));
  return { state, user: check.kind === "valid" ? check.user : null };
}

export async function getViewer(): Promise<SessionUser | null> {
  const { state, user } = await getViewerState();
  if (state === "indisponible") throw new AuthUnavailableError();
  return user;
}

export async function getViewerAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}
