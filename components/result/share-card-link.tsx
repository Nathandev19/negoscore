"use client";

import { DownloadIcon } from "lucide-react";
import { useTier } from "@/components/result/tier-selector";
import { Button } from "@/components/ui/button";
import { SHARE_CARD_FILENAME } from "@/lib/share-card/filename";
import { withTier } from "@/lib/share-card/tier-param";

// « Enregistrer la carte » : téléchargement de l'image générée par
// /analyse/resultat/[id]/carte, réservée au propriétaire de l'analyse. L'adresse
// porte le niveau affiché : la carte montre les chiffres de ce niveau, et le dit.
export function ShareCardLink({ href }: { href: string }) {
  const tier = useTier();
  return (
    <section aria-label="Carte à partager" className="flex flex-col gap-2">
      <Button asChild variant="outline" size="lg" className="w-full sm:w-fit">
        <a href={tier ? withTier(href, tier) : href} download={SHARE_CARD_FILENAME}>
          <DownloadIcon />
          Enregistrer la carte
        </a>
      </Button>
      <p className="text-small text-attenue">
        Score, fourchette, livrables et niveau choisi, sans le nom de la marque ni le tien : prête à poster.
      </p>
    </section>
  );
}
