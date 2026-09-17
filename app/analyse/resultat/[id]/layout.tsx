import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewer } from "@/lib/auth/viewer";
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
export default async function AnalysisLayout({ children, params }: LayoutProps<"/analyse/resultat/[id]">) {
  const { id } = await params;
  const anonToken = (await cookies()).get(ANON_COOKIE)?.value ?? null;
  const user = await getViewer();
  if (!(await loadResultForViewer(id, { user, anonToken }))) notFound();
  return children;
}
