import type { Metadata } from "next";
import { SessionUnavailable } from "@/components/session-unavailable";

export const metadata: Metadata = {
  title: "Connexion momentanément indisponible",
  robots: { index: false, follow: false },
};

// Mission #089 — page de compte demandée pendant une panne de Supabase Auth.
// proxy.ts réécrit la requête vers cette page : l'adresse reste celle de la
// page demandée, et la recharger réessaie. Elle ne dit ni « connecte-toi » ni
// « tu n'es pas connectée » : on ne sait rien de la session.
//
// Mission #089 bis — le texte est dans components/session-unavailable.tsx :
// les pages de résultat l'affichent elles-mêmes, sans passer par le proxy.

export default function SessionUnavailablePage() {
  return <SessionUnavailable />;
}
