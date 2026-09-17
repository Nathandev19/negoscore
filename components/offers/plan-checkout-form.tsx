"use client";

import { useEffect, useRef, useState } from "react";
import { analyticsDistinctId, track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import Link from "next/link";
import { CONSENT_LINK_LABEL, CONSENT_TEXT } from "@/lib/billing/consent";
import { Button } from "@/components/ui/button";

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
  // Identifiant anonyme de la mesure d'audience, écrit directement dans le
  // champ caché : vide si la mesure est désactivée (DNT, pas de clé).
  const distinctIdField = useRef<HTMLInputElement>(null);
  const id = `consent-${plan}`;

  function fillDistinctId() {
    if (distinctIdField.current) distinctIdField.current.value = analyticsDistinctId() ?? "";
  }

  useEffect(fillDistinctId, []);

  return (
    <form action="/api/checkout" method="post" className="flex flex-col gap-3" onSubmit={fillDistinctId}>
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="ph_distinct_id" ref={distinctIdField} defaultValue="" />
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
        disabled={!accepted}
        variant={primary ? "default" : "link"}
        size="lg"
        className={primary ? "h-12 w-full text-base" : "w-fit text-base"}
        onClick={() => track(ANALYTICS_EVENTS.checkoutStarted, { plan })}
      >
        {label}
      </Button>
    </form>
  );
}
