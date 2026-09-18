import type { Metadata } from "next";
import { LoginPageContent } from "@/app/connexion/login-page";

export const metadata: Metadata = {
  title: "Connexion",
  robots: { index: false, follow: false },
};

// Lien de connexion expiré ou déjà servi (mission #074). Les routes
// /auth/confirm et /auth/callback renvoient ici au lieu de /connexion?erreur=lien :
// le message est écrit dans la page statique, donc lisible sans JavaScript,
// alors que ?erreur=lien ne pouvait être lu que dans le navigateur.
export default function LinkExpiredPage() {
  return <LoginPageContent linkExpired />;
}
