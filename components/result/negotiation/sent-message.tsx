"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useState } from "react";
import { CopyButton } from "@/components/result/copy-button";

// Mission #080 bis, B — le message réellement envoyé.
//
// B1 : copier un message enregistre le texte tel qu'il est à l'écran, rattaché
// à son tour ; c'est lui que lira le tour suivant. Aucun crédit, aucun appel au
// modèle (B4). Seulement pour la personne connectée qui a lancé l'analyse :
// ailleurs (aperçu, visiteur), la copie reste une simple copie.

type Recorder = { analysisId: string | null; firstMessage: string | null };

// Posé par la page de résultat : identifiant de l'analyse (propriétaire
// connecté) et message du tour 1 tel qu'il est AFFICHÉ (niveau choisi compris).
export const SentMessageContext = createContext<Recorder>({ analysisId: null, firstMessage: null });

export function useSentRecorder(): Recorder {
  return use(SentMessageContext);
}

export async function recordSentMessage(analysisId: string, turn: number, text: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/analyses/${analysisId}/message-envoye`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turn, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Bouton « Copier le message » qui, en plus, retient le texte copié comme
// message envoyé pour ce tour. Le retour ne s'affiche qu'une fois l'envoi
// réellement enregistré : rien d'annoncé qui n'ait eu lieu.
export function RecordedCopyButton({ text, turn }: { text: string; turn: number }) {
  const { analysisId } = useSentRecorder();
  if (!analysisId) return <CopyButton text={text} />;
  return <RecordingCopy analysisId={analysisId} text={text} turn={turn} />;
}

function RecordingCopy({ analysisId, text, turn }: { analysisId: string; text: string; turn: number }) {
  const router = useRouter();
  const [recorded, setRecorded] = useState(false);
  return (
    <>
      <CopyButton
        text={text}
        onCopied={async (copied) => {
          setRecorded(false);
          if (await recordSentMessage(analysisId, turn, copied)) {
            setRecorded(true);
            // Le fil relit le message retenu, pour le montrer au prochain collage.
            router.refresh();
          }
        }}
      />
      <p role="status" aria-live="polite" className="text-small text-attenue">
        {recorded ? "Retenu comme le message que tu envoies : c'est lui que l'outil aura en tête pour lire la réponse de la marque." : ""}
      </p>
    </>
  );
}
