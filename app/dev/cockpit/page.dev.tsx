import { Cockpit } from "@/components/admin/cockpit";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { COCKPIT_PREVIEWS, cockpitPreviewCaches, type CockpitPreview } from "@/lib/fixtures/cockpit-states";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx, voir next.config.ts) : le
// cockpit rendu depuis une fixture, sans base et sans session propriétaire.
//
// Mission #132 — /admin est réservé au propriétaire : on ne peut pas le
// regarder sans une session vérifiée, et un tableau de bord se juge à l'œil.
// Cette page sert à ça, et à ça seulement : voir les états que les chiffres
// réels ne produisent pas tous les jours — deux jours de données, un mois,
// une période entièrement vide.
//
// Mission #133 — les quatre périodes sont fournies, pas une seule : ce qui se
// juge ici, c'est maintenant le CHANGEMENT de période autant que la période.
// Deux conséquences visibles, propres à cette page : les pastilles écrivent
// « /admin?period=… » dans l'adresse — c'est le composant de /admin, tel quel
// — et le rafraîchissement d'arrière-plan échoue, faute de session
// propriétaire. L'erreur affichée est donc la preuve que les chiffres restent
// quand le réseau ne répond pas.
//
// /dev/cockpit?etat=lancement|vide|un-jour|mois
export default async function CockpitPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const demande = typeof params.etat === "string" ? params.etat : "lancement";
  const etat = (COCKPIT_PREVIEWS.includes(demande as CockpitPreview) ? demande : "lancement") as CockpitPreview;
  return (
    <>
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
        <p className="text-small text-attenue">
          Aperçu de développement, sur des chiffres inventés —{" "}
          {COCKPIT_PREVIEWS.map((valeur) => (
            <a key={valeur} href={`/dev/cockpit?etat=${valeur}`} className={valeur === etat ? "link font-semibold" : "link"}>
              {valeur}{" "}
            </a>
          ))}
        </p>
      </div>
      <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 md:py-14">
        <Cockpit initial={cockpitPreviewCaches(etat)} period="7d" />
      </main>
      <SiteFooter />
    </>
  );
}
