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
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4">
        {amount ? <p className="text-4xl font-black tracking-tight">{amount}</p> : null}
        <ul className="list-disc pl-5 text-base">
          {offer.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

export function ReadyMessage({ message }: { message: Analysis["ready_to_send_message"] }) {
  return (
    <Section title="Ton message prêt à envoyer">
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4">
        <p className="text-sm text-neutral-600">Ton : {message.tone}</p>
        <p className="text-lg leading-relaxed font-medium whitespace-pre-line text-neutral-950">{message.text}</p>
      </div>
      <CopyButton text={message.text} />
    </Section>
  );
}
