import type { ReactNode } from "react";
import { RecordedCopyButton } from "@/components/result/negotiation/sent-message";
import { Section } from "@/components/result/section";
import { COUNTER_FIRST_STEP_TITLE, counterFirstStepSentence } from "@/lib/content/labels";
import { formatEur, formatEurRange } from "@/lib/display";
import type { Analysis } from "@/lib/schema";
import { toneLabel } from "@/lib/tone";

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
  sameAsEstimate = null,
  firstStep = null,
  missing = [],
}: {
  offer: Analysis["counter_offer"];
  title?: string;
  justUnlocked?: boolean;
  // Mission #109, C : l'offre est sous le plancher de la fourchette. Le
  // plancher est alors proposé comme point de départ, à côté de la fourchette
  // complète (lib/analysis/anchoring.ts, counterFirstStep). null partout
  // ailleurs : le cas « montant dans la fourchette » ne change pas.
  firstStep?: number | null;
  // Mission #082 : contre-offre identique à la fourchette estimée, déjà
  // affichée plus haut sous « Fourchette estimée, et ta contre-offre ».
  sameAsEstimate?: "below" | "no_amount" | null;
  // Mission #099, point 9 (audit C1) — offre incomplète : il n'y a pas de
  // montant à afficher, et le bloc doit dire pourquoi plutôt que de lister des
  // demandes sous un titre qui promet un chiffre.
  missing?: readonly string[];
}) {
  const amount = formatEurRange(offer.amount_low, offer.amount_high);
  return (
    <Section title={title} badge={justUnlocked ? <JustUnlockedBadge /> : undefined}>
      <div className="flex flex-col gap-3">
        {missing.length > 0 ? (
          <p className="text-small">
            Cette contre-offre n&apos;a pas de montant : l&apos;offre ne dit pas assez ce qui est demandé pour être
            chiffrée. Il y manque {missing.map((item) => item.toLowerCase()).join(", ")}. Les points ci-dessous, eux, se
            demandent dès maintenant.
          </p>
        ) : null}
        {amount && sameAsEstimate ? (
          <p>
            Toute la fourchette estimée, <span className="font-semibold text-encre tabular-nums">{amount}</span>
            {sameAsEstimate === "below"
              ? " : ce que la marque propose est en dessous de son bas."
              : " : la marque n'a écrit aucun montant."}
          </p>
        ) : amount ? (
          <p className="figures text-5xl leading-none text-encre sm:text-6xl">{amount}</p>
        ) : null}
        {firstStep !== null && amount ? (
          <div data-first-step className="flex flex-col gap-1 border-l-4 border-encre py-1 pl-3">
            <p className="text-small font-semibold text-encre">{COUNTER_FIRST_STEP_TITLE}</p>
            <p className="text-small">{counterFirstStepSentence(formatEur(firstStep), amount)}</p>
          </div>
        ) : null}
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
      <p className="text-small text-attenue">Ton : {toneLabel(message.tone)}</p>
      <p className="border-l-4 border-encre py-1 pl-4 text-lg leading-relaxed whitespace-pre-line text-encre">
        {message.text}
      </p>
      {/* Copier retient ce texte comme message envoyé (tour 1, mission #080 bis). */}
      <RecordedCopyButton text={message.text} turn={1} />
    </Section>
  );
}
