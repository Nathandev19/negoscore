import Link from "next/link";
import { LockIcon, LockOpenIcon } from "lucide-react";
import { Section } from "@/components/result/section";
import { Button } from "@/components/ui/button";

// Bloc de substitution affiché quand le contenu est verrouillé. Il ne reçoit
// aucune donnée de l'analyse : le serveur a retiré ces champs de la réponse.
function Placeholder({ lines }: { lines: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-white" aria-hidden>
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-4 rounded bg-neutral-200" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/40">
        <span className="flex items-center gap-2 rounded-full bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white">
          <LockIcon className="size-4" />
          Verrouillé
        </span>
      </div>
    </div>
  );
}

export function LockedCounterOfferPlaceholder() {
  return (
    <Section title="Ta contre-offre chiffrée">
      <Placeholder lines={4} />
    </Section>
  );
}

export function LockedMessagePlaceholder() {
  return (
    <Section title="Ton message prêt à envoyer">
      <Placeholder lines={5} />
    </Section>
  );
}

export function UnlockCta({ href }: { href: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Button asChild size="lg" className="h-14 w-full text-lg">
        <Link href={href}>
          <LockOpenIcon className="size-5" />
          Débloquer — ton email suffit
        </Link>
      </Button>
      <p className="text-center text-sm text-neutral-600">Pas de mot de passe, pas de carte bancaire.</p>
    </div>
  );
}
