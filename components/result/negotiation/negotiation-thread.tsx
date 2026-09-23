"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ConclusionView } from "@/components/result/negotiation/conclusion-view";
import { useSentRecorder } from "@/components/result/negotiation/sent-message";
import { ThreadError, ThreadPending } from "@/components/result/negotiation/thread-status";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { useTier } from "@/components/result/tier-selector";
import { Button } from "@/components/ui/button";
import { FIRST_TURN, LAST_TURN, MAX_REPLY_LENGTH, type Conclusion, type ThreadAccess, type TurnPayload } from "@/lib/negotiation/types";
import { DEFAULT_TIER } from "@/lib/rates/tier";
import { nextReveal, prefersReducedMotion, reveal, THREAD_PENDING_ID, type ThreadSnapshot } from "@/lib/ui/reveal";

// Mission #080 — « La marque t'a répondu ? » : le fil de l'échange, sous le
// message à envoyer. Chaque réponse collée s'ajoute à CETTE analyse (B1), les
// tours s'affichent dans l'ordre (B4). Les tours sont compris dans l'analyse
// (mission #080 ter) : aucun coût annoncé, aucune formule exigée ; il suffit
// d'être connecté avec le compte qui a lancé l'analyse.

export const THREAD_ANCHOR = "echange";

export type ThreadTurnView = { turnNumber: number; createdAt: string; brandReply: string | null; payload: TurnPayload };

// Message enregistré comme envoyé pour le dernier tour (mission #080 bis).
export type SentView = { text: string; source: "copied" | "corrected"; updatedAt: string };

const SENT_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

// Extrait lisible d'un message : sa première ligne utile, coupée proprement.
export function excerpt(text: string, max = 90): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0 && !/^(bonjour|hello|hi)\b[\s,!.]*$/i.test(l)) ?? text.trim();
  return line.length <= max ? line : `${line.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NegotiationThread({
  analysisId,
  turns,
  conclusion,
  access,
  sent = null,
}: {
  analysisId: string;
  turns: ThreadTurnView[];
  // Conclusion décidée par la personne (sans nouveau tour).
  conclusion: Conclusion | null;
  // « open » : la personne connectée qui a lancé l'analyse.
  access: ThreadAccess;
  sent?: SentView | null;
}) {
  const router = useRouter();
  const tier = useTier() ?? DEFAULT_TIER;
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState<"turn" | "conclusion" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Clé d'idempotence gardée tant que le tour n'a pas abouti (D4) : un second
  // clic ou une reprise après coupure retombe sur le même tour.
  const keyRef = useRef<string | null>(null);
  // B2, B3 — le message auquel la marque répond, selon l'outil : celui retenu
  // à la copie (ou corrigé), sinon le message proposé, gardé comme hypothèse.
  const { firstMessage } = useSentRecorder();
  const proposed = turns.at(-1)?.payload.message.text ?? firstMessage ?? "";
  const assumed = sent?.text ?? proposed;
  // null : pas touché. Sinon, le texte corrigé par la personne.
  const [sentDraft, setSentDraft] = useState<string | null>(null);
  const correction = sentDraft !== null && sentDraft.trim() !== "" && sentDraft.trim() !== assumed.trim() ? sentDraft.trim() : null;
  const sentFieldId = useId();
  const fieldId = useId();
  const noticeId = useId();

  const concluded = conclusion !== null || turns.some((turn) => turn.payload.conclusion !== null);
  const nextTurn = FIRST_TURN + turns.length;
  const turnsLeft = nextTurn <= LAST_TURN;
  const canConclude = !concluded && access === "open";

  // Mission #096, défaut 3 — ce qui vient d'arriver est amené en vue par le
  // HAUT, et prend le focus pour être annoncé. L'état d'avant sert de repère :
  // on ne défile que sur ce qui est NOUVEAU, jamais au premier affichage.
  const seen = useRef<ThreadSnapshot>({ turnNumbers: turns.map((turn) => turn.turnNumber), concluded, error: error !== null });
  useEffect(() => {
    const after: ThreadSnapshot = { turnNumbers: turns.map((turn) => turn.turnNumber), concluded, error: error !== null };
    const id = nextReveal(seen.current, after);
    seen.current = after;
    if (id === null) return;
    // Mission #098 — le repère d'arrivée porte sur le BLOC, pas sur son titre :
    // c'est la carte qu'on doit reconnaître en arrivant dessus.
    const target = document.getElementById(id);
    reveal(target, { flash: target?.closest("article, section") ?? target, reducedMotion: prefersReducedMotion() });
  }, [turns, concluded, error]);

  // L'attente s'affiche là où la réponse apparaîtra, et la page y amène.
  useEffect(() => {
    if (sending !== "turn") return;
    const pending = document.getElementById(THREAD_PENDING_ID);
    reveal(pending, { flash: pending, reducedMotion: prefersReducedMotion() });
  }, [sending]);

  async function sendTurn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (reply.trim().length < 2) {
      setError("Colle la réponse de la marque.");
      return;
    }
    keyRef.current ??= newKey();
    setSending("turn");
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/tours`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply, tier, idempotencyKey: keyRef.current, ...(correction ? { sentMessage: correction } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        keyRef.current = null;
        setReply("");
        setSentDraft(null);
        router.refresh();
        return;
      }
      // Refus définitif (hors sujet, pas de droit, fin des tours) : la clé est
      // abandonnée, le texte reste dans la zone.
      if (response.status < 500) keyRef.current = null;
      setError(body.error ?? "La réponse n'a pas pu être analysée. Réessaie dans quelques minutes.");
    } catch {
      setError("La réponse n'a pas pu être envoyée. Vérifie ta connexion et réessaie.");
    } finally {
      setSending(null);
    }
  }

  async function conclude() {
    if (sending) return;
    setSending("conclusion");
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/conclusion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        router.refresh();
        return;
      }
      setError(body.error ?? "La conclusion n'a pas pu être préparée. Réessaie.");
    } catch {
      setError("La conclusion n'a pas pu être préparée. Vérifie ta connexion et réessaie.");
    } finally {
      setSending(null);
    }
  }

  return (
    <section id={THREAD_ANCHOR} aria-labelledby="echange-titre" className="flex scroll-mt-24 flex-col gap-6">
      <h2 id="echange-titre" tabIndex={-1} className="text-h2">
        La suite de l&apos;échange
      </h2>

      {turns.map((turn) => (
        <TurnCard key={turn.turnNumber} {...turn} />
      ))}
      {conclusion ? <ConclusionView conclusion={conclusion} /> : null}

      {/* L'attente est ici, à la place qu'occupera le tour : pas seulement sur
          le bouton, tout en bas. */}
      {sending === "turn" ? <ThreadPending turnNumber={nextTurn} /> : null}
      {/* L'échec s'affiche au même endroit que l'attente : là où on regardait. */}
      {error ? <ThreadError message={error} /> : null}

      {concluded ? null : !turnsLeft ? (
        <p className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
          Les {LAST_TURN - 1} tours de suivi de cette analyse sont utilisés. Tu peux conclure l&apos;échange avec les termes
          actuels.
        </p>
      ) : access === "open" ? (
        <form onSubmit={sendTurn} className="flex flex-col gap-3">
          <label htmlFor={fieldId} className="text-h3 text-encre">
            La marque t&apos;a répondu ?
          </label>
          <p className="text-small">
            Colle sa réponse : l&apos;outil te dit ce qu&apos;elle accorde, ce qu&apos;elle refuse et ce qu&apos;elle laisse
            sans réponse, puis prépare ton message suivant. Elle s&apos;ajoute à cette analyse, ce n&apos;est pas une nouvelle
            analyse.
          </p>
          {assumed ? (
            <details className="text-small">
              <summary className="cursor-pointer text-attenue">
                La marque répond à ce message, selon l&apos;outil : <span className="text-encre">« {excerpt(assumed)} »</span>
              </summary>
              <div className="mt-2 flex flex-col gap-2 border-l-4 border-filet pl-3">
                <p>
                  {sent
                    ? sent.source === "corrected"
                      ? `Corrigé par toi le ${SENT_DATE.format(new Date(sent.updatedAt))}.`
                      : `Retenu quand tu l'as copié, le ${SENT_DATE.format(new Date(sent.updatedAt))}.`
                    : "Tu ne l'as pas copié depuis l'outil : c'est le message proposé, supposé envoyé."}{" "}
                  Si tu as envoyé autre chose (copié à la main, modifié après la copie), corrige-le ici : c&apos;est ce texte
                  que l&apos;outil aura en tête pour lire la réponse.
                </p>
                <label htmlFor={sentFieldId} className="font-semibold text-encre">
                  Le message que tu as envoyé
                </label>
                <textarea
                  id={sentFieldId}
                  value={sentDraft ?? assumed}
                  onChange={(event) => setSentDraft(event.target.value)}
                  maxLength={MAX_REPLY_LENGTH}
                  rows={6}
                  className="w-full rounded-control border-2 border-encre bg-creme px-3 py-2 text-base text-encre"
                />
                {correction ? <p className="font-semibold text-encre">Ta correction sera retenue quand tu lanceras l&apos;analyse de la réponse.</p> : null}
              </div>
            </details>
          ) : null}
          <textarea
            id={fieldId}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            maxLength={MAX_REPLY_LENGTH}
            rows={5}
            aria-describedby={noticeId}
            placeholder="Colle ici la réponse de la marque…"
            className="w-full rounded-control border-2 border-encre bg-creme px-3 py-2 text-base text-encre placeholder:text-attenue"
          />
          <div id={noticeId} className="flex flex-col gap-1 text-small">
            {/* C4 (#080 ter) : compris dans l'analyse, dit simplement. */}
            <p className="text-attenue">C&apos;est compris dans l&apos;analyse de cette offre, jusqu&apos;à la conclusion.</p>
            <p className="text-attenue">Si le texte n&apos;est pas une réponse à cette offre, l&apos;outil le dit.</p>
            {nextTurn === LAST_TURN ? (
              <p className="font-semibold text-encre">C&apos;est le dernier tour de suivi possible pour cette analyse.</p>
            ) : null}
          </div>
          <Button type="submit" size="lg" aria-busy={sending === "turn"} aria-disabled={sending !== null} className="h-12 w-full text-base sm:w-fit">
            {sending === "turn" ? "Lecture de la réponse… (jusqu'à une minute)" : "Analyser sa réponse"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2 border-l-4 border-encre py-1 pl-4">
          <p className="text-h3 text-encre">La marque t&apos;a répondu ?</p>
          <p className="text-small">
            Connecte-toi avec le compte de cette analyse pour coller sa réponse ici : l&apos;outil te dit ce qu&apos;elle
            accorde, ce qu&apos;elle refuse, et prépare ton message suivant jusqu&apos;à la conclusion.
          </p>
          <p className="text-small">
            <Link href={`/connexion?next=${encodeURIComponent(`/analyse/resultat/${analysisId}#${THREAD_ANCHOR}`)}`} className="link font-semibold">
              Me connecter
            </Link>
          </p>
        </div>
      )}

      {canConclude ? (
        <div className="flex flex-col gap-2">
          <p className="text-small">
            Tu décides d&apos;accepter les termes tels qu&apos;ils sont aujourd&apos;hui ? L&apos;outil prépare le récapitulatif
            de ce qui a été convenu et un message qui demande une confirmation écrite.
          </p>
          <Button type="button" variant="outline" size="lg" onClick={conclude} aria-busy={sending === "conclusion"} aria-disabled={sending !== null} className="w-full sm:w-fit">
            {sending === "conclusion" ? "Préparation…" : "J'accepte ces termes"}
          </Button>
        </div>
      ) : null}

      {error ? <ThreadError message={error} /> : null}
    </section>
  );
}
