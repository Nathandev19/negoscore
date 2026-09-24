import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { DeleteAnalysisView } from "@/components/result/delete-analysis-view";
import { SessionUnavailable } from "@/components/session-unavailable";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewerState } from "@/lib/auth/viewer";
import { ANON_COOKIE } from "@/lib/security/request";

export const metadata: Metadata = {
  title: "Supprimer cette analyse",
  robots: { index: false, follow: false },
};

// Confirmation explicite avant une suppression sans retour. Même contrôle
// d'accès que la page de résultat : un visiteur qui n'en est pas l'auteur
// obtient une page introuvable.
export default async function DeleteAnalysisPage({ params, searchParams }: PageProps<"/analyse/resultat/[id]/supprimer">) {
  const { id } = await params;
  const query = await searchParams;
  const anonToken = (await cookies()).get(ANON_COOKIE)?.value ?? null;
  // Mission #089 bis — pendant une panne d'authentification, cette page disait
  // « introuvable » à la propriétaire, sur une page dont le seul bouton
  // supprime. Elle dit maintenant que ça vient de nous.
  const { state, user } = await getViewerState();
  if (state === "indisponible") return <SessionUnavailable />;
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result) notFound();

  return <DeleteAnalysisView data={{ id, unavailable: query.erreur === "indisponible" }} />;
}
