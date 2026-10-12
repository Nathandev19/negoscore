"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { SOLDE_LIEN, soldeBadge, soldeTexte, soldeTon } from "@/lib/content/labels";
import { cn } from "@/lib/utils";

// Mission #182 — COMBIEN IL EN RESTE, à l'endroit où ça sert.
//
// Deux surfaces, un seul chiffre : l'en-tête (toutes les pages, à côté de
// « Mon compte ») et l'écran de saisie, juste au-dessus du champ. Pas
// /historique : cette page porte le compteur d'analyses FAITES de la #181, et
// deux nombres différents sur un même écran ne se lisent pas.
//
// COMPOSANT CLIENT, parce que l'en-tête l'est : les pages publiques restent
// statiques, et rien de ce qui dépend de la personne n'entre dans leur rendu
// (mission #071). Le solde arrive donc après l'hydratation, par /api/solde.
//
// LE SOLDE EST FRAIS APRÈS UNE ANALYSE, sans vider le cache. Deux raisons :
// l'en-tête est rendu PAR CHAQUE PAGE (jamais dans un layout partagé), donc
// la navigation vers la page de résultat le remonte et relance la lecture ; et
// la requête part en `no-store`, sur une route qui répond `private, no-store`.
// Aucun cache de rendu ne s'interpose.
//
// LECTURE IMPOSSIBLE : on n'affiche RIEN. Jamais un zéro inventé, jamais une
// valeur par défaut — même règle que le compteur de la #181.

export type Solde = { restantes: number | null; rechargeLe: Date | null; intact: boolean };

// ─── UNE SEULE LECTURE PAR PAGE, PARTAGÉE ──────────────────────────────────
//
// MESURÉ : trois exemplaires de ces composants sont montés sur l'accueil (la
// barre de bureau, le panneau mobile, la ligne au-dessus du champ). Avec un
// état par composant, c'était trois requêtes pour un seul nombre — et trois
// occasions d'afficher deux valeurs différentes sur le même écran.
//
// Un magasin de module, abonné par useSyncExternalStore : l'idiome déjà
// employé pour l'indicateur de session et pour le brouillon. La valeur est
// une par CHEMIN, et pas une pour toute la session : sinon, après une
// analyse, la page de résultat resservirait le nombre d'avant. Le chemin
// change, la lecture repart — c'est ce qui rend le solde frais sans vider le
// cache ni se reconnecter.
type Magasin = { cle: string | null; valeur: Solde | null; fini: boolean; abonnes: Set<() => void> };
const magasin: Magasin = { cle: null, valeur: null, fini: false, abonnes: new Set() };

function prevenir() {
  for (const abonne of magasin.abonnes) abonne();
}

function lireLeCorps(value: Record<string, unknown>): Solde | null {
  // Le champ doit être un nombre, ou explicitement null (illimité). Tout le
  // reste — champ absent, 503, corps inattendu — ne donne rien.
  const restantes = value.restantes;
  if (typeof restantes !== "number" && restantes !== null) return null;
  const brut = value.rechargeLe;
  const date = typeof brut === "string" ? new Date(brut) : null;
  return {
    restantes,
    rechargeLe: date && !Number.isNaN(date.getTime()) ? date : null,
    // Absent d'une réponse ancienne : on suppose dépensé, donc le ton le plus
    // prudent. Jamais l'inverse — on ne fabrique pas du calme.
    intact: value.intact === true,
  };
}

function charger(cle: string) {
  // Déjà lu, ou en cours, pour ce chemin : on ne redemande pas.
  if (magasin.cle === cle) return;
  magasin.cle = cle;
  magasin.valeur = null;
  magasin.fini = false;
  prevenir();
  fetch("/api/solde", { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<Record<string, unknown>>) : null))
    .then((value) => {
      // Le chemin a changé pendant la lecture : cette réponse n'est plus celle
      // de la page affichée, et on ne l'affiche pas.
      if (magasin.cle !== cle) return;
      magasin.valeur = value ? lireLeCorps(value) : null;
    })
    .catch(() => undefined)
    .finally(() => {
      if (magasin.cle !== cle) return;
      magasin.fini = true;
      prevenir();
    });
}

function sabonner(abonne: () => void) {
  magasin.abonnes.add(abonne);
  return () => {
    magasin.abonnes.delete(abonne);
  };
}

// null : pas encore lu, ou illisible. Les deux se comportent pareil à l'écran
// (rien), et c'est voulu : « je ne sais pas » ne s'affiche pas en nombre.
export function useSolde(): Solde | null {
  const chemin = usePathname() ?? "/";
  const solde = useSyncExternalStore(
    sabonner,
    () => (magasin.cle === chemin ? magasin.valeur : null),
    () => null,
  );
  // Lancée dans un effet, jamais pendant le rendu : un rendu qui déclenche une
  // requête réseau n'est pas un rendu.
  useEffect(() => {
    charger(chemin);
  }, [chemin]);
  return solde;
}

// ─── L'en-tête ─────────────────────────────────────────────────────────────
//
// Discret par construction : la taille du texte courant de l'en-tête, la même
// couleur atténuée que les liens, aucune icône, aucune bordure. À zéro et au
// seuil bas, le ton monte d'un cran — une graisse, pas une couleur d'alerte :
// un en-tête qui crie suit la personne sur toutes les pages.
export function SoldeEntete({ className }: { className?: string }) {
  const solde = useSolde();
  if (!solde) return null;
  const ton = soldeTon(solde.restantes, solde.intact);
  return (
    <span
      data-solde-entete
      data-ton={ton}
      className={cn("whitespace-nowrap text-small", ton === "discret" ? "font-normal opacity-70" : "font-semibold", className)}
    >
      {soldeBadge(solde.restantes, solde.intact)}
    </span>
  );
}

// ─── L'écran de saisie ─────────────────────────────────────────────────────
//
// Là, il y a de la place pour une phrase, et c'est le moment où la personne
// décide de dépenser. Le ton discret reste gris, à la taille du texte courant,
// sans couleur ni icône. Le ton bas monte UNE fois. Zéro dit ce qui se passe
// ensuite, et porte le lien — jamais un mur.
export function SoldeLigne({ className }: { className?: string }) {
  const solde = useSolde();
  if (!solde) return null;
  const ton = soldeTon(solde.restantes, solde.intact);
  const texte = soldeTexte(solde.restantes, solde.rechargeLe, solde.intact);
  return (
    <p
      data-solde-ligne
      data-ton={ton}
      // role="status" seulement quand le ton monte : annoncer « 12
      // négociations restantes » à chaque ouverture de page interromprait une
      // lecture d'écran pour rien.
      {...(ton === "discret" ? {} : { role: "status" as const })}
      className={cn(
        "text-small",
        ton === "discret" ? "text-attenue" : "border-l-4 border-encre py-1 pl-3 font-semibold text-encre",
        className,
      )}
    >
      {texte}
      {ton === "zero" && solde.rechargeLe === null ? (
        <>
          {" "}
          <Link href={SOLDE_LIEN.href} className="link font-semibold">
            {SOLDE_LIEN.label}
          </Link>
        </>
      ) : null}
    </p>
  );
}
