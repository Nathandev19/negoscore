import Link from "next/link";
import { Section } from "@/components/result/section";
import { Button } from "@/components/ui/button";

// Bloc de substitution affiché quand le contenu est verrouillé. Il ne reçoit
// aucune donnée de l'analyse : le serveur a retiré ces champs de la réponse.
// Seules les barres factices sont masquées aux lecteurs d'écran : l'état
// verrouillé et la façon de le lever sont du texte, entendu comme il est vu
// (mission #062, A2). Avant, tout le bloc était aria-hidden et la section
// n'annonçait rien après son titre.
function Placeholder({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-3 border-y border-filet py-4">
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-3 rounded-pill bg-filet" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
      <p className="text-small font-semibold text-encre">
        Verrouillé. <span className="font-normal">Ton email suffit pour le débloquer, plus bas sur cette page.</span>
      </p>
    </div>
  );
}

export function LockedCounterOfferPlaceholder({ title = "Ta contre-offre chiffrée" }: { title?: string }) {
  return (
    <Section title={title}>
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
        <Link href={href}>Débloquer — ton email suffit</Link>
      </Button>
      <p className="text-center text-small text-attenue">Pas de mot de passe, pas de carte bancaire.</p>
    </div>
  );
}
