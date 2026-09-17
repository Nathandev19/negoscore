"use client";

import { useEffect, useState } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Étapes du traitement, dans l'ordre où le serveur les fait. L'appel au modèle
// est un seul appel : on ne peut pas savoir où il en est. Les étapes défilent
// donc au rythme médian MESURÉ (évaluation du 15/09/2026 sur le modèle de
// production : médiane 14,3 s, maximum 20,1 s sur 20 offres texte), et la
// dernière reste en cours jusqu'à la réponse réelle. C'est une estimation,
// pas une mesure de l'avancement : aucun pourcentage n'est affiché.
export const WAITING_STEPS = [
  { label: "Lecture de l'offre", ms: 3_500 },
  { label: "Identification des droits cédés", ms: 5_000 },
  { label: "Chiffrage sur la table française", ms: 4_000 },
  { label: "Rédaction de ta réponse", ms: null },
] as const;

export const SLOW_AFTER_MS = 30_000;
export const VERY_SLOW_AFTER_MS = 60_000;

export const SLOW_MESSAGE = "Cette offre est longue, l'analyse prend un peu plus de temps.";
export const VERY_SLOW_MESSAGE =
  "C'est plus long que d'habitude. Rien n'est décompté tant que l'analyse n'a pas abouti : si elle échoue, ton crédit reste intact.";

// Étape en cours pour un temps écoulé donné. `finished` : la réponse est là,
// toutes les étapes sont cochées.
export function activeStep(elapsedMs: number, finished: boolean): number {
  if (finished) return WAITING_STEPS.length;
  let threshold = 0;
  for (let index = 0; index < WAITING_STEPS.length; index++) {
    const ms = WAITING_STEPS[index].ms;
    if (ms === null) return index;
    threshold += ms;
    if (elapsedMs < threshold) return index;
  }
  return WAITING_STEPS.length - 1;
}

// startedAgoMs : prévisualisation de développement seulement (écran vu à 35 s, 65 s…).
export function WaitingScreen({ finished, startedAgoMs = 0 }: { finished: boolean; startedAgoMs?: number }) {
  const [elapsed, setElapsed] = useState(startedAgoMs);

  useEffect(() => {
    const started = Date.now() - startedAgoMs;
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 250);
    return () => window.clearInterval(timer);
  }, [startedAgoMs]);

  const active = activeStep(elapsed, finished);
  const note = elapsed >= VERY_SLOW_AFTER_MS ? VERY_SLOW_MESSAGE : elapsed >= SLOW_AFTER_MS ? SLOW_MESSAGE : null;

  return (
    <section aria-label="Analyse en cours" className="flex flex-col gap-6 rounded-control border-2 border-encre p-5 sm:p-6">
      <p className="headline text-h2 text-encre">On analyse ton offre</p>
      <ol className="flex flex-col gap-4" aria-live="polite">
        {WAITING_STEPS.map((step, index) => {
          const done = index < active;
          const current = index === active;
          return (
            <li key={step.label} className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-pill border-2",
                  done && "border-encre bg-encre text-creme",
                  current && "border-encre text-encre",
                  !done && !current && "border-filet",
                )}
              >
                {done ? (
                  <CheckIcon className="size-4" strokeWidth={3} />
                ) : current ? (
                  <LoaderCircleIcon className="size-4 animate-spin" strokeWidth={3} />
                ) : null}
              </span>
              <span className={cn("text-lg", current ? "font-bold text-encre" : done ? "text-encre" : "text-attenue")}>
                {step.label}
                {done ? <span className="sr-only"> : fait</span> : current ? <span className="sr-only"> : en cours</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {note ? (
        <p role="status" className="border-l-4 border-encre pl-3 text-small font-semibold text-encre">
          {note}
        </p>
      ) : null}
    </section>
  );
}
