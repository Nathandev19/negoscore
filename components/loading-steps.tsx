"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Ce que fait réellement le serveur : un long appel au modèle (la lecture),
// puis trois étapes quasi instantanées, faites dans la même requête. Le
// navigateur ne sait qu'une chose : la réponse est arrivée ou non. L'écran dit
// donc exactement cela :
//   - pendant l'appel : seule la lecture est en cours, avec le temps écoulé ;
//     rien d'autre n'est coché ;
//   - à la réponse : la lecture est cochée, puis les trois étapes suivantes
//     s'allument dans l'ordre, très vite, avant l'affichage du résultat.
// Aucune étape n'est cochée avant d'avoir été franchie, aucun pourcentage.

export type WaitingKind = "text" | "photo" | "pdf";

export const READING_LABEL: Record<WaitingKind, string> = {
  text: "Lecture de l'offre",
  photo: "Lecture de la capture",
  pdf: "Lecture du document",
};

export const AFTER_READING_STEPS = [
  "Identification des droits cédés",
  "Chiffrage sur la table française",
  "Rédaction de ta réponse",
] as const;

// Intervalle entre deux étapes cochées après la réponse.
export const REVEAL_STEP_MS = 180;
// Temps total de la séquence après la réponse, avant d'afficher le résultat.
export const REVEAL_TOTAL_MS = REVEAL_STEP_MS * (AFTER_READING_STEPS.length + 1);

export const SLOW_AFTER_MS = 30_000;
export const VERY_SLOW_AFTER_MS = 60_000;

export const SLOW_MESSAGE = "Cette offre est longue, l'analyse prend un peu plus de temps.";
export const VERY_SLOW_MESSAGE =
  "C'est plus long que d'habitude. Rien n'est décompté tant que l'analyse n'a pas abouti : si elle échoue, ta négociation reste entière.";

// Nombre d'étapes cochées (lecture comprise), selon le temps écoulé depuis la
// réponse du modèle. null : pas encore de réponse, rien n'est coché.
export function checkedSteps(msSinceResponse: number | null): number {
  if (msSinceResponse === null) return 0;
  return Math.min(1 + AFTER_READING_STEPS.length, 1 + Math.floor(msSinceResponse / REVEAL_STEP_MS));
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

type WaitingScreenProps = {
  kind: WaitingKind;
  // Moment où la réponse du serveur est arrivée (Date.now()), null avant.
  respondedAt: number | null;
  // Prévisualisation de développement seulement : écran vu à 35 s, 65 s…
  startedAgoMs?: number;
};

export function WaitingScreen({ kind, respondedAt, startedAgoMs = 0 }: WaitingScreenProps) {
  const [now, setNow] = useState(() => Date.now());
  const [startedAt] = useState(() => Date.now() - startedAgoMs);
  const screenRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  // Cet écran remplace le formulaire : sans cela le focus retombe sur <body>
  // et la personne au clavier repart du haut de la page (mission #062, A6).
  useEffect(() => {
    screenRef.current?.focus();
  }, []);

  const elapsed = (respondedAt ?? now) - startedAt;
  const checked = checkedSteps(respondedAt === null ? null : Math.max(0, now - respondedAt));
  const labels = [READING_LABEL[kind], ...AFTER_READING_STEPS];
  const note = respondedAt !== null ? null : elapsed >= VERY_SLOW_AFTER_MS ? VERY_SLOW_MESSAGE : elapsed >= SLOW_AFTER_MS ? SLOW_MESSAGE : null;

  return (
    <section
      ref={screenRef}
      tabIndex={-1}
      aria-label="Analyse en cours"
      aria-busy={respondedAt === null}
      className="flex flex-col gap-6 rounded-control border-2 border-encre p-5 sm:p-6"
    >
      <p className="headline text-h2 text-encre">On analyse ton offre</p>
      <ol className="flex flex-col gap-4" aria-live="polite">
        {labels.map((label, index) => {
          const done = index < checked;
          // Seule la lecture peut être « en cours » : les étapes suivantes sont
          // instantanées et passent directement de l'attente à cochée.
          const current = index === 0 && respondedAt === null;
          return (
            <li key={label} className="flex items-center gap-3">
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
              <span className={cn("flex flex-1 items-baseline justify-between gap-3 text-lg", current ? "font-bold text-encre" : done ? "text-encre" : "text-attenue")}>
                <span>
                  {label}
                  {done ? <span className="sr-only"> : fait</span> : current ? <span className="sr-only"> : en cours</span> : null}
                </span>
                {index === 0 ? (
                  // Décompte visuel seulement : annoncé à chaque seconde, il noierait le lecteur d'écran.
                  <span aria-hidden className="text-small font-semibold text-encre-douce tabular-nums">
                    {formatElapsed(elapsed)}
                  </span>
                ) : null}
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
