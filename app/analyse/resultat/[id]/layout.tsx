import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SessionUnavailable } from "@/components/session-unavailable";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewerState } from "@/lib/auth/viewer";
import { ANON_COOKIE } from "@/lib/security/request";

// Mission #049 : le 404 est décidé ICI, au-dessus de loading.tsx.
// Un notFound() lancé depuis la page arrive après le début du streaming : la
// réponse est déjà partie en 200 et le 404 n'est que visuel. Le layout, lui,
// est attendu avant le moindre octet, donc le code HTTP est un vrai 404.
//
// Les trois cas (identifiant inexistant, analyse d'un autre, analyse
// supprimée) passent par le même appel, qui répond null de la même façon : même
// page, même code, même nombre de lectures en base. Rien ne permet de
// distinguer un identifiant qui existe d'un identifiant qui n'existe pas.
// La lecture est mémorisée par requête : la page réutilise ce résultat.
// Mission #089 bis — l'authentification injoignable N'EST PAS une absence de
// session. Lire la suite avec user = null ferait répondre « introuvable » à la
// propriétaire de l'analyse : un 404 définitif pour une panne passagère. On
// affiche l'état réel, à la même adresse, que recharger réessaie.
export default async function AnalysisLayout({ children, params }: LayoutProps<"/analyse/resultat/[id]">) {
  const { id } = await params;
  const anonToken = (await cookies()).get(ANON_COOKIE)?.value ?? null;
  const { state, user } = await getViewerState();
  if (state === "indisponible") return <SessionUnavailable />;
  if (!(await loadResultForViewer(id, { user, anonToken }))) notFound();
  return children;
}
