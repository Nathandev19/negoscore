"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { ConclusionView } from "@/components/result/negotiation/conclusion-view";
import { useSentRecorder } from "@/components/result/negotiation/sent-message";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { useTier } from "@/components/result/tier-selector";
import { Button } from "@/components/ui/button";
import type { TurnRight } from "@/lib/billing/entitlement";
import { FIRST_TURN, LAST_TURN, MAX_REPLY_LENGTH, type Conclusion, type TurnPayload } from "@/lib/negotiation/types";
import { DEFAULT_TIER } from "@/lib/rates/tier";

// Mission #080 — « La marque t'a répondu ? » : le fil de l'échange, sous le
// message à envoyer. Chaque réponse collée s'ajoute à CETTE analyse (B1), les
// tours s'affichent dans l'ordre (B4). Ce qu'un tour coûte est dit AVANT
// l'envoi (D1) ; sans formule, la zone reste visible et dit comment y accéder
// (D3).

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

// Coût du prochain tour, annoncé avant l'envoi.
export function costNotice(right: TurnRight): string | null {
  if (right.kind === "pack") {
    return `Analyser cette réponse utilise 1 crédit de ton Pack Deal, comme une analyse. Il t'en reste ${right.balance}.`;
  }
  if (right.kind === "pro") {
    return `Analyser cette réponse compte pour 1 analyse de ton abonnement Pro. Il t'en reste ${right.remaining} sur cette période.`;
  }
  return null;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NegotiationThread({
  analysisId,
  turns,
  conclusion,
  right,
  sent = null,
}: {
  analysisId: string;
  turns: ThreadTurnView[];
  // Conclusion décidée par la personne (sans nouveau tour).
  conclusion: Conclusion | null;
  right: TurnRight;
  sent?: SentView | null;
}) {
  const router = useRouter();
  const tier = useTier() ?? DEFAULT_TIER;
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState<"turn" | "conclusion" | null>(null);
  const [error, setError] = useState<{ message: string; paywall: boolean } | null>(null);
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
  const paid = right.kind === "pack" || right.kind === "pro" || right.kind === "no_credit";
  const canConclude = !concluded && (paid || turns.length > 0);

  async function sendTurn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (reply.trim().length < 2) {
      setError({ message: "Colle la réponse de la marque.", paywall: false });
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
      const body = (await response.json().catch(() => ({}))) as { error?: string; paywall?: boolean };
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
      setError({ message: body.error ?? "La réponse n'a pas pu être analysée. Rien n'a été décompté.", paywall: body.paywall === true });
    } catch {
      setError({ message: "La réponse n'a pas pu être envoyée. Vérifie ta connexion et réessaie : rien n'a été décompté.", paywall: false });
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
      const body = (await response.json().catch(() => ({}))) as { error?: string; paywall?: boolean };
      if (response.ok) {
        router.refresh();
        return;
      }
      setError({ message: body.error ?? "La conclusion n'a pas pu être préparée. Réessaie.", paywall: body.paywall === true });
    } catch {
      setError({ message: "La conclusion n'a pas pu être préparée. Vérifie ta connexion et réessaie.", paywall: false });
    } finally {
      setSending(null);
    }
  }

  const notice = costNotice(right);

  return (
    <section id={THREAD_ANCHOR} aria-labelledby="echange-titre" className="flex scroll-mt-24 flex-col gap-6">
      <h2 id="echange-titre" tabIndex={-1} className="text-h2">
        La suite de l&apos;échange
      </h2>

      {turns.map((turn) => (
        <TurnCard key={turn.turnNumber} {...turn} />
      ))}
      {conclusion ? <ConclusionView conclusion={conclusion} /> : null}

      {concluded ? null : !turnsLeft ? (
        <p className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
          Les {LAST_TURN - 1} tours de suivi de cette analyse sont utilisés. Tu peux conclure l&apos;échange avec les termes
          actuels.
        </p>
      ) : right.kind === "pack" || right.kind === "pro" ? (
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
                  que l&apos;outil aura en tête pour lire la réponse. Ça ne décompte rien.
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
            {notice ? <p className="font-semibold text-encre">{notice}</p> : null}
            <p className="text-attenue">
              Si le texte n&apos;est pas une réponse à cette offre, l&apos;outil le dit et rien n&apos;est décompté.
            </p>
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
            {right.kind === "no_credit"
              ? `${right.message} Chaque réponse de marque analysée compte pour une analyse.`
              : "Colle sa réponse ici : l'outil te dit ce qu'elle accorde, ce qu'elle refuse, et prépare ton message suivant jusqu'à la conclusion. C'est compris dans le Pack Deal et l'abonnement Pro, chaque réponse analysée compte pour une analyse."}
          </p>
          <p className="text-small">
            <Link href="/tarifs" className="link font-semibold">
              Voir les formules
            </Link>
          </p>
        </div>
      )}

      {canConclude ? (
        <div className="flex flex-col gap-2">
          <p className="text-small">
            Tu décides d&apos;accepter les termes tels qu&apos;ils sont aujourd&apos;hui ? L&apos;outil prépare le récapitulatif
            de ce qui a été convenu et un message qui demande une confirmation écrite. Ça ne décompte rien.
          </p>
          <Button type="button" variant="outline" size="lg" onClick={conclude} aria-busy={sending === "conclusion"} aria-disabled={sending !== null} className="w-full sm:w-fit">
            {sending === "conclusion" ? "Préparation…" : "J'accepte ces termes"}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="flex flex-col gap-1 alert-bad py-1 text-small">
          <p>{error.message}</p>
          {error.paywall ? (
            <Link href="/tarifs" className="link font-semibold">
              Voir les formules
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
