"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { Button } from "@/components/ui/button";

// Action primaire de la page débloquée : copier le message.
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="lg"
      className="w-full text-base sm:w-fit"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          track(ANALYTICS_EVENTS.messageCopied);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Message copié" : "Copier le message"}
    </Button>
  );
}
