"use client";

import { useState } from "react";
import { track } from "@/lib/analytics/client";
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
      <Link href="/cgv" className="underline">
        {CONSENT_LINK_LABEL}
      </Link>
      {after}
    </>
  );
}

// Case à cocher obligatoire, jamais pré-cochée. Son état est enregistré côté
// serveur, avec la date, par /api/checkout.
export function PlanCheckoutForm({ plan, label }: { plan: "pack" | "pro"; label: string }) {
  const [accepted, setAccepted] = useState(false);
  const id = `consent-${plan}`;

  return (
    <form action="/api/checkout" method="post" className="flex flex-col gap-3">
      <input type="hidden" name="plan" value={plan} />
      <label htmlFor={id} className="flex items-start gap-2 text-xs text-neutral-700">
        <input
          id={id}
          type="checkbox"
          name="consent"
          required
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>{consentWithLink()}</span>
      </label>
      <Button
        type="submit"
        disabled={!accepted}
        className="h-11 w-full"
        onClick={() => track(ANALYTICS_EVENTS.checkoutStarted, { plan })}
      >
        {label}
      </Button>
    </form>
  );
}
