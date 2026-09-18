import type { ReactNode } from "react";
import { CopyButton } from "@/components/result/copy-button";
import { Section } from "@/components/result/section";
import { formatEurRange } from "@/lib/display";
import type { Analysis } from "@/lib/schema";

// Ancre du message prêt à envoyer : c'est là qu'arrive la personne qui vient
// de donner son email pour le débloquer (mission #067).
export const MESSAGE_ANCHOR = "message";

// Signal « débloqué » : une pastille encre, sans animation, affichée seulement
// au chargement qui suit la connexion (components/result/analysis-result.tsx).
export function JustUnlockedBadge(): ReactNode {
  return (
    <span className="inline-flex w-fit shrink-0 rounded-pill bg-encre px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-creme">
      Débloqué à l&apos;instant
    </span>
  );
}

export function CounterOffer({
  offer,
  title = "Ta contre-offre chiffrée",
  justUnlocked = false,
}: {
  offer: Analysis["counter_offer"];
  title?: string;
  justUnlocked?: boolean;
}) {
  const amount = formatEurRange(offer.amount_low, offer.amount_high);
  return (
    <Section title={title} badge={justUnlocked ? <JustUnlockedBadge /> : undefined}>
      <div className="flex flex-col gap-3">
        {amount ? <p className="figures text-5xl leading-none text-encre sm:text-6xl">{amount}</p> : null}
        <ul className="list-disc pl-5">
          {offer.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

// Le message est du texte à copier tel quel : un filet encre à gauche, sans fond.
export function ReadyMessage({
  message,
  justUnlocked = false,
}: {
  message: Analysis["ready_to_send_message"];
  justUnlocked?: boolean;
}) {
  return (
    <Section id={MESSAGE_ANCHOR} title="Ton message prêt à envoyer" badge={justUnlocked ? <JustUnlockedBadge /> : undefined}>
      <p className="text-small text-attenue">Ton : {message.tone}</p>
      <p className="border-l-4 border-encre py-1 pl-4 text-lg leading-relaxed whitespace-pre-line text-encre">
        {message.text}
      </p>
      <CopyButton text={message.text} />
    </Section>
  );
}
