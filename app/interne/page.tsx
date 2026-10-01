import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { INTERNAL_COOKIE, internalSecret, internalTokenValid, markSecret, markSecretValid } from "@/lib/telemetry/internal";

// Mission #127, partie B — marquer CE navigateur comme interne, en un clic.
//
// Pourquoi une page et pas seulement la route de la mission #118 : les
// navigateurs intégrés d'Instagram et de TikTok n'ont pas de barre d'adresse
// modifiable. On n'y arrive qu'en cliquant un lien, et on ne peut rien y lire
// d'autre que ce que la page affiche. Il faut donc voir en toutes lettres si
// ce navigateur-là est marqué, et pouvoir le démarquer du doigt.
//
// SANS LE BON SECRET, CETTE PAGE N'EXISTE PAS : notFound(), pas une erreur
// d'autorisation. Une réponse 401 dirait qu'il y a quelque chose à trouver.
// Même règle que les pages du propriétaire (mission #077).
//
// Elle n'émet AUCUN événement de visite : ni ViewPixel (#120), ni
// FirstPartyView (#103). Elle n'est pas dans MEASURED_PAGES, elle n'est pas
// dans PUBLIC_PAGES, donc ni sitemap ni adresse canonique.
export const metadata: Metadata = { title: "Navigateur interne", robots: { index: false, follow: false } };

// Rendu à chaque requête : l'état dépend d'un cookie.
export const dynamic = "force-dynamic";

export default async function InternalBrowserPage({ searchParams }: PageProps<"/interne">) {
  const params = await searchParams;
  const cle = typeof params.cle === "string" ? params.cle : null;
  // Secret non configuré : personne ne marque rien, et la page n'existe pour
  // personne. markSecretValid le refuse déjà ; c'est écrit deux fois exprès.
  if (markSecret() === null || !markSecretValid(cle)) notFound();

  const marked = internalTokenValid((await cookies()).get(INTERNAL_COOKIE)?.value, internalSecret());

  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 md:py-16">
        <h1 className="text-h1 font-extrabold">Navigateur interne</h1>
        {/* L'état en toutes lettres : c'est la seule chose qu'on puisse lire
            dans un navigateur intégré, où l'adresse n'est pas visible. */}
        <p
          role="status"
          className={`border-l-4 py-2 pl-3 text-body font-semibold ${marked ? "border-marque text-marque" : "border-encre text-encre"}`}
        >
          {marked
            ? "Ce navigateur EST marqué comme interne. Ses visites ne comptent pas dans les chiffres du cockpit."
            : "Ce navigateur n’est PAS marqué. Ses visites comptent comme celles de n’importe quel visiteur."}
        </p>
        <p className="measure text-small text-attenue">
          La marque vit dans un cookie de ce navigateur, pour deux ans. Elle survit à la fermeture de l’application, et
          elle disparaît si tu effaces les données du site. Elle n’autorise rien : elle retire seulement ces visites des
          statistiques.
        </p>
        {/* Formulaires, pas de script : la page tient sans JavaScript, comme le
            reste du produit (garantie #074). Le secret repart en champ caché. */}
        <form method="post" action="/api/interne" className="flex flex-col gap-3">
          <input type="hidden" name="cle" value={cle ?? ""} />
          <input type="hidden" name="action" value={marked ? "retirer" : "marquer"} />
          <Button type="submit" size="lg" className="h-12 w-full text-base sm:w-fit">
            {marked ? "Retirer la marque" : "Marquer ce navigateur comme interne"}
          </Button>
        </form>
      </main>
      <SiteFooter />
    </>
  );
}
