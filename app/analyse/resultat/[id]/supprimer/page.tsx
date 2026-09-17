import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { DeleteAnalysisView } from "@/components/result/delete-analysis-view";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewer } from "@/lib/auth/viewer";
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
  const user = await getViewer();
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result) notFound();

  return <DeleteAnalysisView data={{ id, unavailable: query.erreur === "indisponible" }} />;
}
