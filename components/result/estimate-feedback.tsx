"use client";

import { useId, useState } from "react";
import { useTier } from "@/components/result/tier-selector";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_LABEL,
  FEEDBACK_RATINGS,
  type FeedbackRating,
  type StoredFeedback,
} from "@/lib/analysis/feedback-options";
import { DEFAULT_TIER, TIER_LABEL, type Tier } from "@/lib/rates/tier";
import { cn } from "@/lib/utils";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; tier: Tier } | { kind: "error"; message: string };

// « Cette estimation te paraît juste ? » : trois réponses et un commentaire
// facultatif. Une réponse par analyse, qu'on peut changer. action : l'adresse
// d'enregistrement (null en prévisualisation, où rien n'est envoyé).
// L'avis porte sur les chiffres du niveau affiché, envoyé avec la réponse : après
// un changement de niveau, « c'est enregistré » disparaît, l'avis enregistré
// portant sur l'autre niveau.
export function EstimateFeedback({ action, initial }: { action: string | null; initial: StoredFeedback | null }) {
  const [rating, setRating] = useState<FeedbackRating | null>(initial?.rating ?? null);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const tier = useTier() ?? DEFAULT_TIER;
  const legendId = useId();
  const commentId = useId();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rating) return;
    if (!action) {
      setStatus({ kind: "saved", tier });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment, tier }),
      });
      if (response.ok) {
        setStatus({ kind: "saved", tier });
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      setStatus({ kind: "error", message: typeof body.error === "string" ? body.error : "Ton avis n'a pas pu être enregistré." });
    } catch {
      setStatus({ kind: "error", message: "Ton avis n'a pas pu être enregistré. Vérifie ta connexion et réessaie." });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-t-2 border-encre pt-6">
      <fieldset className="flex flex-col gap-3" aria-describedby={legendId}>
        <legend id={legendId} className="headline mb-3 text-h2 text-encre">
          Cette estimation te paraît juste ?
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {FEEDBACK_RATINGS.map((value) => {
            const selected = rating === value;
            return (
              <label
                key={value}
                className={cn(
                  "flex h-12 cursor-pointer items-center justify-center rounded-control border-2 border-encre px-2 text-center text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marque",
                  selected ? "bg-encre text-creme" : "text-encre hover:bg-filet",
                )}
              >
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={selected}
                  onChange={() => {
                    setRating(value);
                    setStatus({ kind: "idle" });
                  }}
                  className="sr-only"
                />
                {FEEDBACK_LABEL[value]}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={commentId} className="text-small font-semibold text-encre">
          Un mot pour expliquer ? <span className="font-normal text-attenue">(facultatif)</span>
        </label>
        <textarea
          id={commentId}
          value={comment}
          maxLength={FEEDBACK_COMMENT_MAX}
          onChange={(event) => {
            setComment(event.target.value);
            setStatus({ kind: "idle" });
          }}
          rows={2}
          placeholder="Par exemple : la marque paie d'habitude 400 € pour ça."
          className="w-full rounded-control border-2 border-encre bg-creme px-3 py-2 text-base text-encre placeholder:text-attenue"
        />
        <p className="text-right text-xs text-attenue tabular-nums">
          {comment.length} / {FEEDBACK_COMMENT_MAX}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Button type="submit" variant="outline" size="lg" disabled={!rating || status.kind === "saving"} className="w-full sm:w-fit">
          {status.kind === "saving" ? "Envoi…" : initial ? "Modifier mon avis" : "Envoyer mon avis"}
        </Button>
        <p role="status" aria-live="polite" className="text-small">
          {status.kind === "saved" && status.tier === tier
            ? `Merci, c'est enregistré pour le niveau « ${TIER_LABEL[tier].short} ». Tu peux changer ta réponse à tout moment.`
            : null}
        </p>
      </div>
      {status.kind === "error" ? (
        <p role="alert" className="alert-bad text-small">
          {status.message}
        </p>
      ) : null}
      <p className="text-xs text-attenue">
        Seuls ta réponse, ton commentaire, le niveau choisi et les chiffres affichés ici sont enregistrés, avec
        l&apos;analyse.
      </p>
    </form>
  );
}
