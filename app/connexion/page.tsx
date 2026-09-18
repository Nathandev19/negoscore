import type { Metadata } from "next";
import { LoginPageContent } from "@/app/connexion/login-page";

export const metadata: Metadata = {
  title: "Connexion",
  robots: { index: false, follow: false },
};

// Page statique (mission #045) : elle se précharge, un clic l'affiche sans
// rendu serveur. Ce qui dépend de la requête a été sorti de la page :
//   - une personne déjà connectée est redirigée par proxy.ts, après
//     vérification de sa session auprès de Supabase ;
//   - ?next= est lu dans le navigateur, ou, sans JavaScript, par l'action
//     serveur dans l'adresse de la page (mission #074).
// Le formulaire s'envoie sans JavaScript (mission #074) : voir login-form.tsx.
export default function LoginPage() {
  return <LoginPageContent />;
}
