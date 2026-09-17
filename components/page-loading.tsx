import { SiteHeader } from "@/components/site-header";

// État de chargement des pages qui restent dynamiques (mission #045) : elles
// lisent la session ou une analyse en base et ne peuvent pas être préchargées
// en entier. Avec un loading.tsx, Next précharge cet état et l'affiche dès le
// clic, pendant que le serveur rend la page.
//
// Même en-tête que la page qui arrive (pas de saut de couleur), puis une zone
// de contenu de hauteur réservée : le pied de page n'apparaît pas une fraction
// de seconde pour disparaître ensuite. « Chargement… » ne s'affiche qu'après
// 400 ms : une réponse rapide ne le fait jamais clignoter.
export function PageLoading({ tone = "creme" }: { tone?: "creme" | "marque" }) {
  return (
    <>
      <SiteHeader tone={tone} />
      {tone === "marque" ? (
        // Bandeau de verdict des résultats : la surface bleue est déjà là.
        <div aria-hidden className="on-marque grain h-72 bg-marque lg:h-80" />
      ) : null}
      <main className="mx-auto flex min-h-[60vh] w-full max-w-5xl flex-1 flex-col px-4 pt-10 pb-16 sm:px-6 md:pt-16">
        <p role="status" className="page-loading text-small text-attenue">
          Chargement…
        </p>
      </main>
    </>
  );
}
