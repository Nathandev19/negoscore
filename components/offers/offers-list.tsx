"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PlanCheckoutForm } from "@/components/offers/plan-checkout-form";
import { Button } from "@/components/ui/button";
import { Bone } from "@/components/ui/skeleton";
import { CONSENT_TEXT } from "@/lib/billing/consent";
import { hasSessionHint } from "@/lib/auth/session-hint";
import {
  hasProAccess,
  isCancelled,
  isGrantedPro,
  offerAction,
  periodEndsAt,
  type AccountView,
  type PlanState,
} from "@/lib/billing/plan-access";
import { FEATURED_PLAN, PLANS } from "@/lib/billing/plans";
import {
  PRO_OFFERED,
  proInProgress,
  RECHARGE_ACTION,
  RECHARGE_FEATURES,
  RECHARGE_NAME,
  RECHARGE_SUMMARY,
  SIGN_IN_TO_PAY,
  takePlan,
} from "@/lib/content/vocabulaire";
import { WITH_JS_ONLY, WITHOUT_JS } from "@/lib/no-js";
import { cn } from "@/lib/utils";

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const LOGIN_HREF = `/connexion?next=${encodeURIComponent("/tarifs")}`;

// Le cookie indicateur ne change qu'avec un chargement complet de page.
const subscribe = () => () => undefined;

// Liste des formules (mission #045) : la page /tarifs est statique, et ce
// composant choisit les boutons dans le navigateur.
//   - Rendu serveur et avant hydratation : l'état de la majorité des visiteurs,
//     « Se connecter pour payer ».
//   - Indicateur de session présent (ns_session) : boutons de paiement. C'est un
//     choix d'AFFICHAGE seulement : /api/checkout vérifie la session auprès de
//     Supabase, renvoie vers la connexion si elle n'est plus valide, et refuse
//     un second abonnement Pro.
//   - Compte lu par /api/credits (session vérifiée côté serveur) : présentation
//     d'un abonné Pro en cours (Pack affiché comme recharge, Pro comme formule en
//     cours) ; session invalide : retour à l'état non connecté.
//
// Mission #071 — rien d'achetable tant qu'on ne sait pas qui regarde. Quatre
// états, jamais confondus :
//   - INCONNU (rendu serveur, avant hydratation, puis tant que /api/credits
//     n'a pas répondu à un visiteur qui porte l'indicateur) : à la place des
//     boutons, une attente inerte de la même taille. Noms, prix et contenus
//     restent affichés : ils ne dépendent pas du compte, et la page reste
//     indexable telle quelle ;
//   - VISITEUR sans session : « Se connecter pour payer » ;
//   - COMPTE lu : les vrais boutons, ou la formule en cours ;
//   - ILLISIBLE (réseau) : on le dit, sans bouton.
// Avant, l'état inconnu était rendu comme « pas abonné » : un abonné Pro
// voyait pendant une à deux secondes « Prendre Pro » cliquable.
export function OffersList() {
  // null : pas encore lu (rendu serveur, hydratation).
  const hinted = useSyncExternalStore(subscribe, () => hasSessionHint(document.cookie), () => null);
  // undefined : pas encore lu ; null : pas de session valide ; "illisible" : réponse impossible.
  const [credits, setCredits] = useState<PlanState | null | undefined | "illisible">(undefined);

  useEffect(() => {
    if (!hinted) return;
    let stale = false;
    fetch("/api/credits", { cache: "no-store" })
      .then(async (response): Promise<PlanState | null | "illisible"> => {
        if (response.ok) return (await response.json()) as PlanState;
        // 401 : pas de session valide. Toute autre réponse : on ne sait pas.
        return response.status === 401 ? null : "illisible";
      })
      .catch((): "illisible" => "illisible")
      .then((value) => {
        if (!stale) setCredits(value);
      });
    return () => {
      stale = true;
    };
  }, [hinted]);

  const account: AccountView =
    hinted === null
      ? "inconnu"
      : !hinted
        ? "visiteur"
        : credits === undefined
          ? "inconnu"
          : credits === null
            ? "visiteur"
            : credits;
  const known = typeof account === "object" ? account : null;
  // Mission #111 — ce que le compte possède déjà, décidé au même endroit pour
  // toute l'application (lib/billing/plan-access.ts). Un accès Pro OFFERT n'a
  // pas de period_end : lu avec isProActive seul, il était invisible, et la
  // page proposait « Prendre Pro » à quelqu'un qui l'avait déjà.
  const proAccess = hasProAccess(known);
  const proOffered = isGrantedPro(known);
  const proCancelled = proAccess && isCancelled(known);
  const proEndsAt = periodEndsAt(known);
  const proEndsAtLabel = proEndsAt ? DATE.format(proEndsAt) : null;

  return (
    <ul className="flex flex-col" aria-busy={account === "inconnu"}>
      {account === "inconnu" ? (
        <li className="sr-only" role="status">
          Lecture de ton compte avant d&apos;afficher les boutons de paiement.
        </li>
      ) : null}
      {PLANS.map((plan) => {
        // Même prix, même plan Whop, même parcours : seule la présentation
        // change. Mission #111 — le Pack devient une RECHARGE pour qui a déjà
        // des négociations en réserve, et plus seulement pour un abonné Pro :
        // un compte qui vient d'acheter un pack se voyait proposer « Prendre
        // Pack Deal », comme s'il n'avait rien.
        // Mission #111 — la décision est prise hors du composant, une seule
        // fois, et se teste seule (lib/billing/plan-access.ts).
        const action = offerAction(plan.id, account);
        const asRecharge = action === "recharger";
        const isCurrentPro = action === "formule_en_cours";
        const featured = plan.id === FEATURED_PLAN;
        const name = asRecharge ? RECHARGE_NAME : plan.name;
        const summary = asRecharge ? RECHARGE_SUMMARY : plan.summary;
        const features = asRecharge ? RECHARGE_FEATURES[proAccess ? "pro" : "reserve"] : plan.features;
        return (
          <li
            key={plan.id}
            className={cn(
              "grid gap-x-10 gap-y-4 border-t py-8 last:border-b md:grid-cols-[15rem_1fr_16rem] md:items-start",
              featured ? "border-encre md:py-10 [&+li]:border-t-encre" : "border-filet",
            )}
          >
            <div className="flex flex-col gap-1">
              <h2 className={cn("font-bold", featured ? "text-h2" : "text-h3")}>{name}</h2>
              <p className={cn("figures tracking-tight text-encre", featured ? "text-5xl" : "text-3xl")}>
                {plan.price}
                {plan.period ? <span className="font-sans text-base font-medium text-attenue"> {plan.period}</span> : null}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-semibold text-encre">{summary}</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
            {plan.id === "free" ? (
              <Link href="/analyse" className="link flex min-h-11 w-fit items-center font-semibold">
                Analyser un deal
              </Link>
            ) : (
              // Emplacement de hauteur fixe (mission #071) : quel que soit
              // l'état, il garde la taille du formulaire d'achat. Aucun passage
              // d'un état à l'autre ne bouscule la page.
              <ActionSlot primary={featured}>
                {isCurrentPro ? (
                  <div className="flex flex-col gap-1">
                    <p className="alert-bad py-1 text-sm">
                      {proOffered ? PRO_OFFERED : proInProgress(proEndsAtLabel, proCancelled)}
                    </p>
                    {/* Accès offert : il n'y a pas d'abonnement chez le
                        prestataire de paiement, donc rien à résilier. Le lien
                        y menait à une page qui répond « aucun abonnement ». */}
                    {proCancelled || proOffered ? null : (
                      <Link href="/resilier" className="link flex min-h-11 w-fit items-center text-sm">
                        Résilier votre contrat
                      </Link>
                    )}
                  </div>
                ) : action === "attente" ? (
                  <PendingPurchase primary={featured} />
                ) : action === "illisible" ? (
                  <p className="text-sm">Ton compte n&apos;a pas pu être lu. Recharge la page pour payer.</p>
                ) : action === "acheter" || action === "recharger" ? (
                  <PlanCheckoutForm plan={plan.id} label={asRecharge ? RECHARGE_ACTION : takePlan(plan.name)} primary={featured} />
                ) : featured ? (
                  <Button asChild size="lg" className="h-12 w-full text-base">
                    <Link href={LOGIN_HREF}>{SIGN_IN_TO_PAY}</Link>
                  </Button>
                ) : (
                  <Link href={LOGIN_HREF} className="link flex min-h-11 w-fit items-center font-semibold">
                    {SIGN_IN_TO_PAY}
                  </Link>
                )}
              </ActionSlot>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Emplacement des contrôles d'achat. Dessous, une copie INVISIBLE du formulaire
// (texte de consentement réel, case, bouton) fixe la hauteur ; dessus, l'état
// affiché. Le formulaire connecté a donc exactement cette taille, et les autres
// états (attente, « Se connecter pour payer », formule en cours) tiennent dedans.
function ActionSlot({ primary, children }: { primary: boolean; children: React.ReactNode }) {
  return (
    <div className="grid">
      <div aria-hidden className="invisible col-start-1 row-start-1 flex flex-col gap-3">
        <span className="flex items-start gap-2 text-xs">
          <span className="mt-0.5 size-4 shrink-0" />
          <span>{CONSENT_TEXT}</span>
        </span>
        <span className={primary ? "block h-12" : "block h-11"} />
      </div>
      <div className="col-start-1 row-start-1">{children}</div>
    </div>
  );
}

// Attente inerte à la place des contrôles d'achat, taillée comme eux : deux
// lignes pour la case de consentement, puis le bouton. Rien de cliquable,
// rien de focalisable.
function PendingPurchase({ primary }: { primary: boolean }) {
  return (
    <>
      {/* Sans JavaScript (mission #073), l'état du compte ne sera jamais lu et
          le paiement ne peut pas partir : on le dit, à la place de l'attente,
          qui ne se résoudrait jamais. La connexion reste offerte par l'en-tête.
          Pas de <noscript> (mission #076) : voir app/layout.tsx. */}
      <p {...WITHOUT_JS} className="text-sm">
        Le paiement demande JavaScript. Active-le dans ton navigateur pour choisir une formule.
      </p>
      <PendingBones primary={primary} />
    </>
  );
}

function PendingBones({ primary }: { primary: boolean }) {
  return (
    // Sans JavaScript, l'attente ne se résoudrait jamais : elle est masquée.
    <div aria-hidden data-pending-purchase {...WITH_JS_ONLY} className="flex flex-col gap-3">
      <span className="flex flex-col gap-1 text-xs">
        <Bone className="h-[0.7em] w-full" />
        <Bone className="h-[0.7em] w-3/4" />
      </span>
      {primary ? <Bone className="h-12 w-full rounded-control" /> : <Bone className="h-11 w-40 rounded-control" />}
    </div>
  );
}
