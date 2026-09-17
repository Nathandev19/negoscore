"use client";

import { useState } from "react";
import { WaitingScreen, type WaitingKind } from "@/components/loading-steps";
import { Button } from "@/components/ui/button";

// DÉVELOPPEMENT UNIQUEMENT : l'écran d'attente, avec un bouton qui simule
// l'arrivée de la réponse du modèle (aucun appel réel).
export function WaitingSimulation({ kind, startedAgoMs }: { kind: WaitingKind; startedAgoMs: number }) {
  const [respondedAt, setRespondedAt] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <WaitingScreen key={run} kind={kind} respondedAt={respondedAt} startedAgoMs={startedAgoMs} />
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={() => setRespondedAt(Date.now())} disabled={respondedAt !== null}>
          Simuler la réponse du modèle
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setRespondedAt(null);
            setRun((value) => value + 1);
          }}
        >
          Recommencer
        </Button>
      </div>
    </div>
  );
}
