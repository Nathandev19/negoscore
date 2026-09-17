"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { REVEAL_TOTAL_MS, WaitingScreen } from "@/components/loading-steps";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { clearPendingKey, pendingKey } from "@/lib/analysis/pending-key";

const MIN_TEXT_LENGTH = 20;
// Message d'échec (mission #060) : il n'affirme plus que la relance gratuite
// est intacte — elle a pu partir sans que la réponse revienne. Réappuyer
// renvoie la même clé d'idempotence, donc le résultat déjà produit s'il existe.
const GENERIC_ERROR =
  "La relance n'a pas abouti. Vérifie ta connexion, puis appuie de nouveau : si elle était déjà partie, tu retrouves ton résultat sans perdre ta relance gratuite.";
// Une seule reprise automatique, et seulement sur une coupure réseau.
const RETRY_DELAY_MS = 1500;

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
    // Même clé à chaque tentative : une relance déjà partie est rendue, elle
    // n'est jamais payée deux fois (mission #060).
    const payload = JSON.stringify({ text, retryOf: originId, idempotencyKey: pendingKey("relance") });
    const send = () =>
      fetch("/api/analyse", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
    try {
      const response = await send().catch(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
        return send();
      });
      const body = (await response.json().catch(() => ({}))) as { analysisId?: unknown; error?: unknown };
      if (response.ok && typeof body.analysisId === "string") {
        setRespondedAt(Date.now());
        clearPendingKey("relance");
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
