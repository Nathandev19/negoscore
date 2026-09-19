"use client";

import { useActionState, useId, useState } from "react";
import { useTier } from "@/components/result/tier-selector";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_LABEL,
  FEEDBACK_RATINGS,
  turnLabel,
  type FeedbackRating,
  type StoredFeedback,
} from "@/lib/analysis/feedback-options";
import { DEFAULT_TIER, TIER_LABEL, type Tier } from "@/lib/rates/tier";
import { saveFeedbackWithoutJs, type FeedbackWithoutJsState } from "@/lib/forms/no-js-actions";
import { cn } from "@/lib/utils";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; tier: Tier } | { kind: "error"; message: string };

// « Cette estimation te paraît juste ? » : trois réponses et un commentaire
// facultatif. Une réponse par analyse, qu'on peut changer. action : l'adresse
// d'enregistrement (null en prévisualisation, où rien n'est envoyé).
// L'avis porte sur les chiffres du niveau affiché, envoyé avec la réponse : après
// un changement de niveau, « c'est enregistré » disparaît, l'avis enregistré
// portant sur l'autre niveau.
//
// Sans JavaScript (mission #075), le formulaire part vers une action serveur qui
// transmet à la même route ; le serveur rend ensuite ce composant avec sa
// réponse (« c'est enregistré », ou l'erreur), réponse et commentaire remis en
// place. Avant, l'envoi rechargeait la page avec ?rating=… dans l'adresse et
// l'avis était perdu, sans un mot.
//
// Mission #086 — turn : le tour dont la page affiche les chiffres (0 : l'offre
// d'origine). Il part avec l'avis, et le serveur enregistre les chiffres de CE
// tour. Un avis déjà donné sur un autre tour n'est pas pré-rempli : il jugeait
// d'autres chiffres, et le formulaire le dit.
export function EstimateFeedback({
  action,
  initial: stored,
  turn = 0,
}: {
  action: string | null;
  initial: StoredFeedback | null;
  turn?: number;
}) {
  // Avis d'avant la mission #086 : supposé porter sur l'offre d'origine.
  const storedTurn = stored ? (stored.turn ?? 0) : null;
  const initial = stored && storedTurn === turn ? stored : null;
  const previous = stored && storedTurn !== turn ? stored : null;
  // Identifiant de l'analyse, lu dans l'adresse d'enregistrement.
  const analysisId = action?.match(/^\/api\/analyses\/([^/]+)\/avis$/)?.[1] ?? null;
  const [server, serverAction] = useActionState(saveFeedbackWithoutJs, { status: "idle" } as FeedbackWithoutJsState);
  const fromServer = server.status === "idle" ? null : server;
  const [rating, setRating] = useState<FeedbackRating | null>(
    (fromServer?.rating as FeedbackRating | undefined) || initial?.rating || null,
  );
  const [comment, setComment] = useState(fromServer?.comment ?? initial?.comment ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const tier = useTier() ?? DEFAULT_TIER;
  const legendId = useId();
  const commentId = useId();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Le bouton reste cliquable et focusable même indisponible (A12) : on dit
    // pourquoi plutôt que de ne rien faire.
    if (status.kind === "saving") return;
    if (!rating) {
      setStatus({ kind: "error", message: "Choisis une réponse avant d'envoyer." });
      return;
    }
    if (!action) {
      setStatus({ kind: "saved", tier });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment, tier, turn }),
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
    <form
      // Sans JavaScript : l'action serveur. Avec JavaScript, submit l'intercepte.
      action={analysisId ? serverAction : undefined}
      onSubmit={submit}
      className="flex flex-col gap-4 border-t-2 border-encre pt-6"
    >
      {analysisId ? <input type="hidden" name="analysisId" value={analysisId} /> : null}
      <input type="hidden" name="tier" value={tier} />
      <input type="hidden" name="turn" value={turn} />
      <fieldset className="flex flex-col gap-3" aria-describedby={legendId}>
        <legend id={legendId} className="headline mb-3 text-h2 text-encre">
          Cette estimation te paraît juste ?
        </legend>
        {turn > 0 ? (
          <p className="text-small">
            La fourchette affichée plus haut, calculée sur {turnLabel(turn)}.
          </p>
        ) : null}
        {previous ? (
          <p className="text-small text-attenue">
            Ton avis précédent portait sur {turnLabel(previous.turn ?? 0)}
            {previous.turn === null ? " (supposé : il date d'avant l'enregistrement du tour)" : ""}. Un nouvel avis le
            remplace.
          </p>
        ) : null}
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
          name="comment"
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
        {/* Occupé ou sans réponse choisie : le bouton reste dans l'ordre de
            tabulation et annoncé, au lieu de disparaître du clavier (A12). */}
        <Button
          type="submit"
          variant="outline"
          size="lg"
          aria-busy={status.kind === "saving"}
          aria-disabled={!rating || status.kind === "saving"}
          className="w-full sm:w-fit"
        >
          {status.kind === "saving" ? "Envoi…" : initial ? "Modifier mon avis" : "Envoyer mon avis"}
        </Button>
        <p role="status" aria-live="polite" className="text-small">
          {(status.kind === "saved" && status.tier === tier) ||
          (status.kind === "idle" && fromServer?.status === "saved" && fromServer.tier === tier)
            ? `Merci, c'est enregistré pour le niveau « ${TIER_LABEL[tier].short} »${turn > 0 ? `, sur ${turnLabel(turn)}` : ""}. Tu peux changer ta réponse à tout moment.`
            : null}
        </p>
      </div>
      {status.kind === "error" ? (
        <p role="alert" className="alert-bad text-small">
          {status.message}
        </p>
      ) : status.kind === "idle" && fromServer?.status === "error" ? (
        <p role="alert" className="alert-bad text-small">
          {fromServer.message}
        </p>
      ) : null}
      <p className="text-xs text-attenue">
        Seuls ta réponse, ton commentaire, le niveau choisi, le tour de négociation et les chiffres affichés ici sont
        enregistrés, avec l&apos;analyse.
      </p>
    </form>
  );
}
