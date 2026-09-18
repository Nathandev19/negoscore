"use client";

import { DownloadIcon, ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTier } from "@/components/result/tier-selector";
import { Bone } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { Tier } from "@/lib/rates/tier";
import { SHARE_CARD_FILENAME } from "@/lib/share-card/filename";
import { withTier } from "@/lib/share-card/tier-param";

// Carte partageable (mission #064). Avant : un bouton qui téléchargeait une
// image jamais vue. Maintenant :
//   1. « Voir ma carte » : UNE génération par /analyse/resultat/[id]/carte,
//      au clic seulement — jamais au chargement de la page, où chaque vue
//      paierait un rendu d'image pour des gens qui ne cliqueront pas ;
//   2. la carte s'affiche à sa proportion réelle, 9:16 ;
//   3. « Enregistrer la carte » enregistre CE fichier-là (même blob) : ce qui
//      est affiché est exactement ce qui est téléchargé, rien de plus.
// La carte porte le niveau affiché au moment du clic. Si le niveau change
// ensuite, la carte montrée n'est plus la bonne : on revient au bouton.

type State =
  | { kind: "idle" }
  | { kind: "loading"; tier: Tier | null }
  | { kind: "ready"; tier: Tier | null; url: string }
  | { kind: "error" };

const ERROR_MESSAGE =
  "La carte n'a pas pu être créée. Réessaie dans un instant ; si ça recommence, recharge la page.";

export function ShareCardLink({ href }: { href: string }) {
  const tier = useTier();
  const [state, setState] = useState<State>({ kind: "idle" });
  // Adresse locale de l'image affichée, libérée dès qu'elle est remplacée.
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  // Carte générée pour un autre niveau que celui affiché : périmée.
  const stale = (state.kind === "ready" || state.kind === "loading") && state.tier !== tier;
  const view: State = stale ? { kind: "idle" } : state;

  async function generate() {
    if (view.kind === "loading") return;
    const forTier = tier;
    setState({ kind: "loading", tier: forTier });
    try {
      const response = await fetch(forTier ? withTier(href, forTier) : href, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("réponse non image");
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setState({ kind: "ready", tier: forTier, url });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <section aria-label="Carte à partager" className="flex flex-col gap-3">
      {view.kind === "loading" ? <CardPlaceholder /> : null}

      {view.kind === "ready" ? (
        // eslint-disable-next-line @next/next/no-img-element -- image locale (blob) : next/image ne s'applique pas
        <img
          src={view.url}
          alt="Ta carte à partager : score, fourchette, livrables et niveau, sans le nom de la marque ni le tien."
          width={1080}
          height={1920}
          className="aspect-[9/16] h-auto w-full max-w-72 rounded-control border-2 border-encre sm:max-w-80"
        />
      ) : null}

      {view.kind === "ready" ? (
        // Contour, pas plein : le bouton plein reste l'action principale de la page.
        <Button asChild variant="outline" size="lg" className="w-full sm:w-fit">
          <a href={view.url} download={SHARE_CARD_FILENAME}>
            <DownloadIcon />
            Enregistrer la carte
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={generate}
          aria-busy={view.kind === "loading"}
          aria-disabled={view.kind === "loading"}
          className="w-full sm:w-fit"
        >
          <ImageIcon />
          {view.kind === "loading" ? "Création de ta carte…" : view.kind === "error" ? "Réessayer" : "Voir ma carte"}
        </Button>
      )}

      {view.kind === "error" ? (
        <p role="alert" className="alert-bad text-small">
          {ERROR_MESSAGE}
        </p>
      ) : null}

      <p className="text-small text-attenue">
        Score, fourchette, livrables et niveau choisi, sans le nom de la marque ni le tien : prête à poster.
      </p>
    </section>
  );
}

// Attente à la forme de la carte : un cadre 9:16 et, dedans, les os des blocs
// qui vont apparaître aux mêmes places (signe, score, pastille, jauge, montants,
// niveau). Pulsation figée par prefers-reduced-motion (règle globale).
function CardPlaceholder() {
  return (
    <div
      data-card-placeholder
      className="flex aspect-[9/16] w-full max-w-72 flex-col rounded-control border-2 border-filet px-[7%] pt-[10%] pb-[11%] sm:max-w-80"
    >
      <p role="status" className="sr-only">
        Création de ta carte
      </p>
      <div className="flex items-center gap-2">
        <Bone className="aspect-square w-[8%]" />
        <Bone className="h-3 w-[40%]" />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-[6%]">
        <Bone className="h-[18%] w-[62%] rounded-control" />
        <Bone className="h-6 w-[48%]" />
        <Bone className="h-2.5 w-full" />
        <div className="flex flex-col gap-2">
          <Bone className="h-4 w-[70%]" />
          <Bone className="h-4 w-[80%]" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Bone className="h-3 w-[55%]" />
        <Bone className="h-3 w-[65%]" />
      </div>
    </div>
  );
}
