"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { SOLDE_LIEN, soldePastille, soldeTexte, soldeTon } from "@/lib/content/labels";
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
// « etat » est un objet STABLE, remplacé seulement quand il change :
// useSyncExternalStore compare par identité, et en reconstruire un à chaque
// lecture ferait boucler le rendu.
type Magasin = { cle: string | null; etat: { fini: boolean; valeur: Solde | null }; abonnes: Set<() => void> };
const magasin: Magasin = { cle: null, etat: { fini: false, valeur: null }, abonnes: new Set() };

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
  magasin.etat = { fini: false, valeur: null };
  prevenir();
  let lu: Solde | null = null;
  fetch("/api/solde", { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<Record<string, unknown>>) : null))
    .then((value) => {
      // Le chemin a changé pendant la lecture : cette réponse n'est plus celle
      // de la page affichée, et on ne l'affiche pas.
      if (magasin.cle !== cle) return;
      lu = value ? lireLeCorps(value) : null;
    })
    .catch(() => undefined)
    .finally(() => {
      if (magasin.cle !== cle) return;
      magasin.etat = { fini: true, valeur: lu };
      prevenir();
    });
}

function sabonner(abonne: () => void) {
  magasin.abonnes.add(abonne);
  return () => {
    magasin.abonnes.delete(abonne);
  };
}

// Mission #194, E — DEUX ÉTATS QUI NE SE RESSEMBLENT PAS, et on cesse de les
// confondre.
//
// « valeur null » couvrait jusqu'ici deux situations opposées : la lecture
// n'est pas finie, et la lecture a échoué. Le magasin distinguait déjà les
// deux par « fini » ; les composants, eux, le devinaient — c'est-à-dire ne le
// savaient pas. D'où un écran vide dans les deux cas, et un contenu qui
// surgissait en poussant la mise en page.
//
//   { fini: false, valeur: null }  on attend  → la place est réservée, vide
//   { fini: true,  valeur: null }  échec      → la place est rendue
//   { fini: true,  valeur: … }     lu         → le contenu
//
// « valeur » ne contient JAMAIS de nombre inventé dans aucun des trois cas :
// c'est la règle de la #182, et elle est intacte.
export type EtatSolde = { fini: boolean; valeur: Solde | null };

const EN_ATTENTE: EtatSolde = { fini: false, valeur: null };

// CE QUE L'ÉCRAN FAIT DE CES TROIS ÉTATS, décidé une seule fois pour les deux
// surfaces. Sans ça, la règle était écrite deux fois et pouvait diverger.
//
//   contenu   le solde est lu : on l'affiche ;
//   attente   la lecture n'est pas finie : la place est réservée, VIDE ;
//   rien      la lecture est finie sans résultat : la place est rendue.
//
// L'attente et l'échec ne se ressemblent donc pas, et aucun des trois états
// ne produit de chiffre que le serveur n'a pas donné.
export type Affichage = "contenu" | "attente" | "rien";

export function affichageSolde(etat: EtatSolde): Affichage {
  if (etat.valeur !== null) return "contenu";
  return etat.fini ? "rien" : "attente";
}

// Mission #194, C — LE SOLDE INTERDIT-IL D'ENVOYER ?
//
// Sortie du composant parce que c'est la seule partie subtile, et que s'en
// tromper se paie des deux côtés : bloquer quelqu'un qui a le droit, ou
// laisser partir une requête qui reviendra refusée dans plusieurs secondes.
//
//   valeur === null        pas encore lu, ou lecture échouée → NON. On ne
//                          bloque jamais sur une absence de réponse ;
//   restantes === null     aucun plafond → NON, il n'y a rien à bloquer ;
//   restantes <= 0         lu, et il ne reste rien → OUI.
export function soldeBloque(valeur: Solde | null): boolean {
  return valeur !== null && valeur.restantes !== null && valeur.restantes <= 0;
}

export function useSolde(): EtatSolde {
  const chemin = usePathname() ?? "/";
  const etat = useSyncExternalStore(
    sabonner,
    () => (magasin.cle === chemin ? magasin.etat : EN_ATTENTE),
    // Rendu serveur : on attend, par définition. La place est donc réservée
    // dès le premier affichage, et rien ne bouge à l'hydratation.
    () => EN_ATTENTE,
  );
  // Lancée dans un effet, jamais pendant le rendu : un rendu qui déclenche une
  // requête réseau n'est pas un rendu.
  useEffect(() => {
    charger(chemin);
  }, [chemin]);
  return etat;
}

// ─── L'en-tête ─────────────────────────────────────────────────────────────
//
// Pastille cliquable sur fond distinct, avec le nombre en premier. Le ton du
// solde reste disponible pour les autres surfaces qui expliquent la recharge.
export function SoldeEntete({ className }: { className?: string }) {
  const { fini, valeur: solde } = useSolde();
  // Attente : la pastille, aux mêmes dimensions, SANS TEXTE. Elle n'annonce
  // aucun nombre — il n'y en a pas encore — mais elle prend la place que le
  // nombre prendra, pour que rien ne pousse la mise en page à son arrivée.
  // aria-hidden : il n'y a rien à lire, et une pastille vide annoncée serait
  // du bruit.
  if (solde === null) {
    if (affichageSolde({ fini, valeur: solde }) === "rien") return null;
    return (
      <span
        aria-hidden
        data-solde-attente
        className={cn(
          "inline-flex min-h-11 min-w-11 animate-pulse items-center justify-center rounded-control border-2 border-filet bg-filet px-2 text-[13px] max-[359px]:px-1 max-[359px]:text-[10px]",
          className,
        )}
      >
        {/* Un espace insécable large : il donne la hauteur de ligne du texte
            final sans écrire un seul caractère visible. */}
        &#8195;
      </span>
    );
  }
  const ton = soldeTon(solde.restantes, solde.intact);
  const pastille = soldePastille(solde.restantes);
  return (
    <Link
      href={pastille.href}
      data-solde-entete
      data-ton={ton}
      aria-label={`${pastille.nombre} ${pastille.libelle}`}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-control border-2 border-encre bg-filet px-2 text-[13px] whitespace-nowrap text-encre hover:bg-creme max-[359px]:px-1 max-[359px]:text-[10px]",
        className,
      )}
    >
      <strong className="font-extrabold tabular-nums">{pastille.nombre}</strong>
      <span><span>{pastille.court}</span><span className="max-[359px]:hidden">{pastille.libelle.slice(pastille.court.length)}</span></span>
    </Link>
  );
}

// ─── L'écran de saisie ─────────────────────────────────────────────────────
//
// Là, il y a de la place pour une phrase, et c'est le moment où la personne
// décide de dépenser. Le ton discret reste gris, à la taille du texte courant,
// sans couleur ni icône. Le ton bas monte UNE fois. Zéro dit ce qui se passe
// ensuite, et porte le lien — jamais un mur.
export function SoldeLigne({ className }: { className?: string }) {
  const { fini, valeur: solde } = useSolde();
  // Même règle qu'au-dessus : une ligne de la même hauteur, vide, pendant
  // l'attente ; plus rien quand la lecture a échoué.
  if (solde === null) {
    if (affichageSolde({ fini, valeur: solde }) === "rien") return null;
    return (
      <p aria-hidden data-solde-attente className={cn("text-small text-attenue", className)}>
        &#8195;
      </p>
    );
  }
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
