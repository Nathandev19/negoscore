"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { Button } from "@/components/ui/button";

// Action primaire de la page débloquée : copier le message.
// onCopied (mission #080 bis) : appelé avec le texte copié, pour l'enregistrer
// comme message envoyé à la marque.
export function CopyButton({ text, onCopied }: { text: string; onCopied?: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
    {/* Région live montée vide puis remplie : la confirmation est annoncée,
        alors qu'un simple changement de libellé de bouton ne l'est pas
        (mission #062, A8). */}
    <p role="status" aria-live="polite" className="sr-only">
      {copied ? "Message copié. Tu peux le coller dans ta réponse à la marque." : ""}
    </p>
    <Button
      type="button"
      size="lg"
      className="w-full text-base sm:w-fit"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          track(ANALYTICS_EVENTS.messageCopied);
          onCopied?.(text);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Message copié" : "Copier le message"}
    </Button>
    </>
  );
}
