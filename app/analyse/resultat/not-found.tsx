import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = {
  title: "Analyse introuvable",
  robots: { index: false, follow: false },
};

// 404 des pages de résultat (mission #067), rendue quand le layout de
// /analyse/resultat/[id] refuse l'analyse. Comme le layout, elle ne dit JAMAIS
// si l'identifiant existe : même texte pour une analyse inexistante, supprimée
// ou appartenant à quelqu'un d'autre.
//
// Connecté, le cas typique est un lien de connexion ouvert dans un autre
// navigateur que celui de l'analyse, sans réclamation utilisable (lien demandé
// avant la #067, ou secret perdu en route) : la personne doit savoir qu'elle
// EST connectée et comment récupérer son analyse.
export default async function ResultNotFound() {
  const viewer = await getViewer().catch(() => null);
  const signedIn = viewer !== null;
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        {signedIn ? (
          <>
            <div className="flex flex-col gap-3">
              <h1 className="text-h1 font-extrabold">Cette analyse n&apos;est pas sur ton compte</h1>
              <p>
                Tu es bien connecté. Mais cette analyse n&apos;est pas rattachée à ton compte : elle a sans doute été
                faite sans compte, dans un autre navigateur, ou elle a été supprimée depuis.
              </p>
              <p>
                Pour la retrouver, retourne dans le navigateur où tu l&apos;as lancée et clique à nouveau sur
                «&nbsp;Débloquer&nbsp;». Elle sera rattachée à ton compte, même si tu ouvres ensuite le lien reçu par
                email ailleurs.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button asChild size="lg" className="h-12 text-base">
                <Link href="/historique">Mes négociations</Link>
              </Button>
              <Link href="/analyse" className="link flex min-h-11 w-fit items-center font-semibold">
                Analyser un deal
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <p className="figures text-6xl text-attenue">404</p>
              <h1 className="text-h1 font-extrabold">Page introuvable</h1>
              <p>Cette page n&apos;existe pas, ou tu n&apos;y as pas accès depuis ce navigateur.</p>
            </div>
            <Button asChild size="lg" className="h-12 text-base">
              <Link href="/analyse">Analyser un deal</Link>
            </Button>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
