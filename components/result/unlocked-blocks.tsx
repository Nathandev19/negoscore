import { CopyButton } from "@/components/result/copy-button";
import { Section } from "@/components/result/section";
import { formatEurRange } from "@/lib/display";
import type { Analysis } from "@/lib/schema";

export function CounterOffer({
  offer,
  title = "Ta contre-offre chiffrée",
}: {
  offer: Analysis["counter_offer"];
  title?: string;
}) {
  const amount = formatEurRange(offer.amount_low, offer.amount_high);
  return (
    <Section title={title}>
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
export function ReadyMessage({ message }: { message: Analysis["ready_to_send_message"] }) {
  return (
    <Section title="Ton message prêt à envoyer">
      <p className="text-small text-attenue">Ton : {message.tone}</p>
      <p className="border-l-4 border-encre py-1 pl-4 text-lg leading-relaxed whitespace-pre-line text-encre">
        {message.text}
      </p>
      <CopyButton text={message.text} />
    </Section>
  );
}
