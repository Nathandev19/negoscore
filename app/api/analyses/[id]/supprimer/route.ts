import { deleteAnalysisForViewer } from "@/lib/analysis/delete";
import { getRequestUser } from "@/lib/auth/request-user";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

// Suppression définitive d'une analyse, après la page de confirmation.
export async function POST(request: Request, { params }: RouteContext<"/api/analyses/[id]/supprimer">) {
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  if (form?.get("confirmation") !== "oui") return redirect(`/analyse/resultat/${encodeURIComponent(id)}/supprimer`);

  const user = await getRequestUser(request);
  // Même lecture que la page de résultat : session pour une analyse rattachée à
  // un compte, cookie anonyme pour une analyse qui ne l'est pas.
  const anonToken = readCookie(request, ANON_COOKIE);
  try {
    const outcome = await deleteAnalysisForViewer(id, { user, anonToken });
    // Rien à supprimer pour cette personne : même réponse qu'une analyse inexistante.
    if (!outcome.deleted) return new Response("Analyse introuvable.", { status: 404 });
    return redirect("/analyse/supprimee");
  } catch (caught) {
    console.error(
      JSON.stringify({ event: "analysis_delete_error", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }),
    );
    return redirect(`/analyse/resultat/${encodeURIComponent(id)}/supprimer?erreur=indisponible`);
  }
}
