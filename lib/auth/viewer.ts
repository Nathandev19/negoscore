import { cookies } from "next/headers";
import { ACCESS_COOKIE, userFromAccessToken, type SessionUser } from "@/lib/auth/session";

// Utilisateur connecté d'une page serveur, vérifié auprès de Supabase Auth.

export async function getViewer(): Promise<SessionUser | null> {
  return userFromAccessToken((await cookies()).get(ACCESS_COOKIE)?.value);
}

export async function getViewerAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}
