import type { ReactNode } from "react";
import { CopyIcon, LockIcon } from "lucide-react";
import { Section } from "@/components/result/section";
import { Button } from "@/components/ui/button";
import { formatEurRange } from "@/lib/display";
import type { Analysis } from "@/lib/schema";

function Blurred({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-white">
      <div aria-hidden className="pointer-events-none blur-[7px] select-none">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/30">
        <span className="flex items-center gap-2 rounded-full bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white">
          <LockIcon className="size-4" />
          Verrouillé
        </span>
      </div>
    </div>
  );
}

export function LockedCounterOffer({ offer }: { offer: Analysis["counter_offer"] }) {
  const amount = formatEurRange(offer.amount_low, offer.amount_high);
  return (
    <Section title="Ta contre-offre chiffrée">
      <Blurred>
        <div className="flex flex-col gap-3 p-4">
          {amount ? <p className="text-4xl font-black tracking-tight">{amount}</p> : null}
          <ul className="list-disc pl-5 text-base">
            {offer.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      </Blurred>
    </Section>
  );
}

export function LockedMessage({ message }: { message: Analysis["ready_to_send_message"] }) {
  return (
    <Section title="Ton message prêt à envoyer">
      <Blurred>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-neutral-600">Ton : {message.tone}</p>
          <p className="text-lg leading-relaxed font-medium text-neutral-950">{message.text}</p>
        </div>
      </Blurred>
      <Button type="button" variant="outline" disabled className="w-full">
        <CopyIcon />
        Copier le message
      </Button>
    </Section>
  );
}
