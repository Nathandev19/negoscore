"use client";

import { useEffect, useRef, useState } from "react";
import { analyticsDistinctId, track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import Link from "next/link";
import { CONSENT_LINK_LABEL, CONSENT_TEXT } from "@/lib/billing/consent";
import { Button } from "@/components/ui/button";
import { currentAttribution } from "@/components/analytics/first-party-view";

// Le texte de la case est celui enregistré en base : on ne le réécrit pas,
// on rend simplement « conditions générales de vente » cliquable.
function consentWithLink() {
  const [before, after] = CONSENT_TEXT.split(CONSENT_LINK_LABEL);
  return (
    <>
      {before}
      <Link href="/cgv" className="link">
        {CONSENT_LINK_LABEL}
      </Link>
      {after}
    </>
  );
}

// Case à cocher obligatoire, jamais pré-cochée. Son état est enregistré côté
// serveur, avec la date, par /api/checkout.
// primary : bouton plein pour la formule mise en avant, lien souligné pour les autres.
export function PlanCheckoutForm({ plan, label, primary }: { plan: "pack" | "pro"; label: string; primary: boolean }) {
  const [accepted, setAccepted] = useState(false);
  // Un seul envoi (mission #071) : un double clic ne part pas deux fois vers
  // le paiement. Le serveur a sa propre garde ; celle-ci évite l'aller-retour.
  const sentRef = useRef(false);
  const [sending, setSending] = useState(false);
  // Identifiant anonyme de la mesure d'audience, écrit directement dans le
  // champ caché : vide si la mesure est désactivée (DNT, pas de clé).
  const distinctIdField = useRef<HTMLInputElement>(null);
  const attributionField = useRef<HTMLInputElement>(null);
  const id = `consent-${plan}`;

  function fillDistinctId() {
    if (distinctIdField.current) distinctIdField.current.value = analyticsDistinctId() ?? "";
    if (attributionField.current) attributionField.current.value = JSON.stringify(currentAttribution());
  }

  // Le départ en paiement se compte à l'envoi réel du formulaire, pas au clic :
  // sans la case cochée, le navigateur refuse l'envoi et rien ne part
  // (mission #062, A12).
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (sentRef.current) {
      event.preventDefault();
      return;
    }
    sentRef.current = true;
    setSending(true);
    fillDistinctId();
    track(ANALYTICS_EVENTS.checkoutStarted, { plan });
  }

  useEffect(fillDistinctId, []);

  // Retour arrière depuis la page de paiement : la page est restaurée telle
  // quelle par le navigateur. Le formulaire redevient utilisable.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      sentRef.current = false;
      setSending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <form action="/api/checkout" method="post" className="flex flex-col gap-3" onSubmit={onSubmit}>
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="ph_distinct_id" ref={distinctIdField} defaultValue="" />
      <input type="hidden" name="attribution" ref={attributionField} defaultValue="" />
      <label htmlFor={id} className="flex items-start gap-2 text-xs">
        <input
          id={id}
          type="checkbox"
          name="consent"
          required
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-encre"
        />
        <span>{consentWithLink()}</span>
      </label>
      <Button
        type="submit"
        // Tant que la case n'est pas cochée, le bouton reste atteignable au
        // clavier (mission #062, A12) : le clic déclenche alors la validation
        // du navigateur, qui dit quoi cocher, au lieu d'un bouton muet.
        aria-disabled={!accepted || sending}
        aria-busy={sending}
        variant={primary ? "default" : "link"}
        size="lg"
        className={primary ? "h-12 w-full text-base" : "w-fit text-base"}
      >
        {label}
      </Button>
    </form>
  );
}
