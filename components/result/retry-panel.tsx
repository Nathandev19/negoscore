"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { REVEAL_TOTAL_MS, WaitingScreen } from "@/components/loading-steps";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MIN_TEXT_LENGTH = 20;
const GENERIC_ERROR = "La relance n'a pas abouti. Vérifie ta connexion et réessaie : ta relance gratuite n'a pas été utilisée.";

// État sérialisable, calculé par la page serveur (lib/analysis/retry.ts).
export type RetryPanelState =
  | { kind: "available"; until: string }
  | { kind: "used"; retryHref: string | null }
  | { kind: "expired" }
  | { kind: "retry_still_incomplete" };

// Relance gratuite d'une analyse incomplète, sur sa page de résultat.
// originId : l'analyse d'origine ; null en prévisualisation, où rien n'est envoyé.
export function RetryPanel({ state, originId }: { state: RetryPanelState; originId: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [respondedAt, setRespondedAt] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; paywall: boolean } | null>(null);
  const fieldId = useId();
  const helpId = useId();

  if (state.kind !== "available") {
    return (
      <section aria-label="Relance de l'analyse" data-retry={state.kind} className="flex flex-col gap-2 border-y border-filet py-4">
        {state.kind === "used" ? (
          <p className="text-small text-encre">
            Tu as déjà relancé cette analyse avec les informations obtenues.{" "}
            {state.retryHref ? (
              <Link href={state.retryHref} className="link font-semibold">
                Voir la relance
              </Link>
            ) : null}
          </p>
        ) : state.kind === "expired" ? (
          <p className="text-small text-encre">
            La relance gratuite était possible pendant 14 jours après l&apos;analyse : ce délai est passé. Une nouvelle
            analyse consommera un droit.
          </p>
        ) : (
          <p className="text-small text-encre">
            Il manque encore des informations, et cette analyse était déjà ta relance gratuite : il n&apos;y en a pas
            d&apos;autre. Une nouvelle analyse consommera un droit. Attends d&apos;avoir les contenus demandés, ce que la
            marque en fera et le montant avant de la lancer.
          </p>
        )}
        {state.kind !== "used" ? (
          <Link href="/analyse" className="link w-fit text-small font-semibold">
            Analyser un deal
          </Link>
        ) : null}
      </section>
    );
  }

  async function relaunch() {
    setError(null);
    setRespondedAt(null);
    setRunning(true);
    if (!originId) {
      // Prévisualisation : aucun envoi.
      setRunning(false);
      return;
    }
    try {
      const response = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, retryOf: originId }),
      });
      const body = (await response.json().catch(() => ({}))) as { analysisId?: unknown; error?: unknown };
      if (response.ok && typeof body.analysisId === "string") {
        setRespondedAt(Date.now());
        const target = `/analyse/resultat/${body.analysisId}`;
        window.setTimeout(() => router.push(target), REVEAL_TOTAL_MS);
        return;
      }
      setError({ message: typeof body.error === "string" ? body.error : GENERIC_ERROR, paywall: response.status === 402 });
    } catch {
      setError({ message: GENERIC_ERROR, paywall: false });
    }
    setRunning(false);
  }

  if (running) return <WaitingScreen kind="text" respondedAt={respondedAt} />;

  const canSubmit = text.trim().length >= MIN_TEXT_LENGTH;
  return (
    <form
      aria-label="Relancer l'analyse"
      data-retry="available"
      className="flex flex-col gap-3 border-t-2 border-encre pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void relaunch();
      }}
    >
      <h2 className="headline text-h2 text-encre">Tu as obtenu les infos manquantes ?</h2>
      <p id={helpId} className="text-small">
        Colle l&apos;offre complétée : le message de la marque et sa réponse à tes questions. La relance est gratuite,
        une seule fois, jusqu&apos;au {state.until}.
      </p>
      <label htmlFor={fieldId} className="sr-only">
        Offre complétée
      </label>
      <Textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-describedby={helpId}
        rows={6}
        placeholder="Colle ici le message de la marque et sa réponse."
      />
      <Button type="submit" size="lg" disabled={!canSubmit} className="w-full sm:w-fit">
        {/* Le titre pose déjà la question « Tu as obtenu les infos manquantes ? » : le bouton
            tient sur une ligne à 320 px. */}
        Relancer l&apos;analyse
      </Button>
      {error ? (
        <p role="alert" className="alert-bad text-small">
          {error.message}{" "}
          {error.paywall ? (
            <Link href="/tarifs" className="link font-semibold">
              Voir les tarifs
            </Link>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
