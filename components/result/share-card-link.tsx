import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SHARE_CARD_FILENAME } from "@/lib/share-card/filename";

// « Enregistrer la carte » : téléchargement de l'image générée par
// /analyse/resultat/[id]/carte, réservée au propriétaire de l'analyse.
export function ShareCardLink({ href }: { href: string }) {
  return (
    <section aria-label="Carte à partager" className="flex flex-col gap-2">
      <Button asChild variant="outline" size="lg" className="w-full sm:w-fit">
        <a href={href} download={SHARE_CARD_FILENAME}>
          <DownloadIcon />
          Enregistrer la carte
        </a>
      </Button>
      <p className="text-small text-attenue">
        Score, fourchette et livrables, sans le nom de la marque ni le tien : prête à poster.
      </p>
    </section>
  );
}
