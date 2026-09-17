import { SiteHeader } from "@/components/site-header";
import { BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";
import { TIER_LABEL, TIERS } from "@/lib/rates/tier";

// Squelette de la page de résultat (app/analyse/resultat/[id]/loading.tsx,
// mission #048). Même bandeau bleu, mêmes marges, même premier bloc que la page
// réelle d'une analyse notée, pour que rien ne bouge à l'arrivée du contenu.
//
// Rien de l'analyse n'y figure ni ne s'y devine (C4) :
//   - la phrase de verdict est remplacée par deux lignes fantômes ;
//   - la place du score, de la pastille et de la jauge est RÉSERVÉE par un bloc
//     invisible (visibility: hidden) aux mêmes dimensions, sans aucune forme
//     dessinée : ni chiffre, ni jauge, ni couleur de bande ;
//   - la fourchette est une barre neutre, pas un montant.
// Le choix du niveau est le même texte pour toutes les analyses : il est
// affiché tel quel, sans niveau sélectionné.
export function ResultSkeleton() {
  return (
    <>
      <SiteHeader tone="marque" />
      <LoadingAnnouncement />
      <section aria-hidden className="on-marque grain bg-marque text-creme">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 sm:px-6 lg:pt-10 lg:pb-14">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
            <span className="headline flex flex-col text-verdict lg:order-last">
              <BoneLine onMarque />
              <BoneLine onMarque width="w-2/3" />
            </span>
            {/* Réserve la hauteur du score, de la pastille, de la jauge et du rappel de niveau. */}
            <div data-reserved-score className="invisible flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                <p className="figures flex items-baseline leading-none">
                  <span className="text-[7rem] leading-[0.8] sm:text-[9rem]">00</span>
                  <span className="text-4xl">/100</span>
                </p>
                <span className="headline mb-3 rounded-pill px-4 py-1.5 text-lg sm:text-xl">Deal</span>
              </div>
              <div className="h-3 w-full" />
              <p className="text-small">Niveau</p>
            </div>
          </div>
        </div>
      </section>
      <main
        aria-hidden
        className="mx-auto flex min-h-screen w-full max-w-5xl flex-1 flex-col gap-12 px-4 pt-8 pb-16 sm:px-6 md:pt-12 md:pb-24 [&>*]:max-w-2xl"
      >
        <section className="flex flex-col gap-3">
          <h2 className="text-h2">Ce que ça vaut</h2>
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-semibold text-encre">Ton niveau</legend>
              <p className="text-small text-attenue">
                La fourchette dépend de ton expérience. Change de niveau : tout est recalculé ici, sans nouvelle analyse.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {TIERS.map((tier) => (
                  <div key={tier} className="flex flex-col gap-0.5 rounded-control border-2 border-filet px-3 py-2.5 text-attenue">
                    <span className="font-semibold">{TIER_LABEL[tier].title}</span>
                    <span className="text-small">{TIER_LABEL[tier].detail}</span>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-1">
              <p className="text-small text-attenue">Fourchette estimée</p>
              <BoneLine width="w-3/4" className="figures text-5xl leading-none sm:text-6xl" />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
