"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ConclusionView } from "@/components/result/negotiation/conclusion-view";
import { useSentRecorder } from "@/components/result/negotiation/sent-message";
import { ThreadError, ThreadPending } from "@/components/result/negotiation/thread-status";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { useTier } from "@/components/result/tier-selector";
import { Button } from "@/components/ui/button";
// Mission #137 — les valeurs viennent du module sans dépendance, les types
// du module des schémas. Un `import type` est effacé à la compilation : il
// ne fait entrer zod nulle part.
import { FIRST_TURN, LAST_TURN, MAX_REPLY_LENGTH, MIN_REPLY_LENGTH, TOO_SHORT_REPLY_MESSAGE, type ThreadAccess } from "@/lib/negotiation/libelles";
import type { Conclusion, TurnPayload } from "@/lib/negotiation/types";
import { exchanges, NEGOTIATION_EXCHANGES } from "@/lib/content/vocabulaire";
import { saveTurnWithoutJs, type TurnWithoutJsState } from "@/lib/forms/no-js-actions";
import { clearThreadDraft, draftSurvives, readThreadKey, readThreadReply, saveThreadDraft, subscribeThreadDraft } from "@/lib/negotiation/draft";
import { DEFAULT_TIER } from "@/lib/rates/tier";
import { nextResume } from "@/lib/analysis/resume";
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

// Mission #104, A4 — cet extrait sert à RECONNAÎTRE le message auquel la
// marque répond, sans le déplier. « Bonjour Camille, » ne reconnaît rien : la
// salutation est la même dans tous les messages. On cherche donc la ligne qui
// identifie vraiment ce message-là — celle qui porte le tarif — et à défaut la
// première ligne qui ne soit ni une salutation ni un remerciement.
const GREETING = /^(?:bonjour|bonsoir|hello|hi|salut|coucou)\b[^.!?]{0,40}[.!…]?$/i;
const THANKS = /^(?:merci|mille mercis)\b[^.!?]{0,60}[.!…]?$/i;

export function excerpt(text: string, max = 90): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const useful = lines.filter((line) => !GREETING.test(line) && !THANKS.test(line));
  // Le tarif est ce qui distingue un message d'un autre dans un échange.
  // À défaut de tarif, la première ligne utile ; à défaut, la première qui ne
  // soit pas une salutation (un message tout en politesse reste identifiable
  // par son remerciement) ; à défaut, ce qu'il y a.
  const line =
    useful.find((entry) => /\d[\d\s\u00a0\u202f]*(?:€|eur\b|euros?\b)/i.test(entry)) ??
    useful[0] ??
    lines.find((entry) => !GREETING.test(entry)) ??
    lines[0] ??
    text.trim();
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
  // Mission #099 (audits B15 et C3) — sans JavaScript, c'est l'action serveur
  // qui répond, et ce qu'elle renvoie contient le texte soumis. Avec
  // JavaScript, le brouillon du navigateur prend le relais : ni le texte ni la
  // clé d'idempotence ne se perdent au rechargement.
  const [server, serverAction] = useActionState(saveTurnWithoutJs, { status: "idle" } as TurnWithoutJsState);
  const draft = useSyncExternalStore(subscribeThreadDraft, () => readThreadReply(analysisId), () => "");
  // Mission #102 — le texte saisi appartient au TOUR qu'on prépare. Quand le
  // tour arrive (y compris pendant une absence, par resynchronisation), le
  // numéro suivant change et la zone repart du brouillon — vide — au lieu de
  // garder la réponse déjà envoyée.
  const [edited, setEdited] = useState<{ turn: number; text: string } | null>(null);
  const [sending, setSending] = useState<"turn" | "conclusion" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Clé d'idempotence gardée tant que le tour n'a pas abouti (D4) : un second
  // clic ou une reprise après coupure retombe sur le même tour. Mission #099 :
  // elle est gardée AVEC le brouillon, donc elle survit au rechargement.
  const keyRef = useRef<string | null>(null);
  // Mission #102 : départ de l'attente, et dernière resynchronisation lancée.
  const [attempt, setAttempt] = useState<{ startedAt: number; lastCheckAt: number | null } | null>(null);

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
  const reply = edited?.turn === nextTurn ? edited.text : server.status === "error" ? server.reply : draft;
  function setReply(value: string) {
    setEdited({ turn: nextTurn, text: value });
    saveThreadDraft(analysisId, { reply: value, key: keyRef.current });
  }
  const turnsLeft = nextTurn <= LAST_TURN;
  // Mission #102, partie A6 — même défaut que l'analyse : sur iPhone, quitter
  // l'application pendant la lecture coupe la requête, qui ne revient jamais.
  // Le tour, lui, est enregistré côté serveur. Au retour, on redemande la page
  // au serveur (router.refresh) et l'attente s'arrête dès que le tour attendu
  // est dans le fil — sans jamais renvoyer la réponse collée une seconde fois.
  // Le tour qu'on attend. Posé à l'envoi (dans le gestionnaire, jamais pendant
  // un rendu) : c'est sa présence dans le fil, rendu par le serveur, qui dit
  // que la réponse est arrivée — que ce soit par la requête d'origine ou par
  // une resynchronisation au retour.
  const [awaited, setAwaited] = useState<number | null>(null);
  const arrived = awaited !== null && turns.some((turn) => turn.turnNumber === awaited);
  const waiting: "turn" | "conclusion" | null = sending === "turn" && !arrived ? "turn" : sending === "conclusion" ? "conclusion" : null;

  useEffect(() => {
    if (!arrived) return;
    // Le tour est arrivé : plus rien à rejouer, et le brouillon a fait son temps.
    keyRef.current = null;
    clearThreadDraft(analysisId);
  }, [arrived, analysisId]);

  useEffect(() => {
    if (waiting !== "turn") return;
    const onBack = () => {
      if (document.visibilityState === "hidden") return;
      const decision = nextResume({
        local: { key: attempt === null ? null : "tour", startedAt: attempt?.startedAt ?? null, lastCheckAt: attempt?.lastCheckAt ?? null },
        server: null,
        now: Date.now(),
      });
      if (decision.action !== "verifier") return;
      setAttempt((current) => (current === null ? current : { ...current, lastCheckAt: Date.now() }));
      // Lecture seule : la page est rendue par le serveur, qui a le fil réel.
      router.refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("pageshow", onBack);
    window.addEventListener("online", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("pageshow", onBack);
      window.removeEventListener("online", onBack);
    };
  }, [waiting, router, attempt]);
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
    if (waiting !== "turn") return;
    const pending = document.getElementById(THREAD_PENDING_ID);
    reveal(pending, { flash: pending, reducedMotion: prefersReducedMotion() });
  }, [waiting]);

  async function sendTurn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (waiting) return;
    if (reply.trim().length < MIN_REPLY_LENGTH) {
      setError(TOO_SHORT_REPLY_MESSAGE);
      return;
    }
    keyRef.current ??= readThreadKey(analysisId) ?? newKey();
    // Gardée avec le brouillon : un rechargement en plein traitement la
    // retrouve, et le second envoi est reconnu comme le même tour.
    saveThreadDraft(analysisId, { reply, key: keyRef.current });
    setAwaited(nextTurn);
    setAttempt({ startedAt: Date.now(), lastCheckAt: null });
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
        setEdited(null);
        setSentDraft(null);
        // Tour accepté : le brouillon n'a plus de raison d'être.
        clearThreadDraft(analysisId);
        router.refresh();
        return;
      }
      // Refus définitif (hors sujet, pas de droit, fin des tours) : la clé est
      // abandonnée, le texte reste dans la zone. Une panne, elle, garde tout
      // (lib/negotiation/draft.ts) — 503 d'authentification injoignable compris.
      if (!draftSurvives(response.status)) {
        keyRef.current = null;
        // Refus définitif : la clé est abandonnée, le TEXTE reste (audit B15).
        saveThreadDraft(analysisId, { reply, key: null });
      }
      setError(body.error ?? "La réponse n'a pas pu être analysée. Réessaie dans quelques minutes.");
    } catch {
      setError("La réponse n'a pas pu être envoyée. Vérifie ta connexion et réessaie.");
    } finally {
      setSending(null);
    }
  }

  async function conclude() {
    if (waiting) return;
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
      {waiting === "turn" ? <ThreadPending turnNumber={nextTurn} /> : null}
      {/* L'échec s'affiche au même endroit que l'attente : là où on regardait. */}
      {error ?? (server.status === "error" ? server.message : null) ? (
        <ThreadError message={error ?? (server.status === "error" ? server.message : "")} />
      ) : null}

      {concluded ? null : !turnsLeft ? (
        <p className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
          Les {exchanges(NEGOTIATION_EXCHANGES)} de cette négociation sont utilisés. Tu peux conclure l&apos;échange avec les
          termes actuels.
        </p>
      ) : access === "open" ? (
        <form action={serverAction} onSubmit={sendTurn} className="flex flex-col gap-3">
          <input type="hidden" name="analysisId" value={analysisId} />
          <input type="hidden" name="tier" value={tier} />
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
            name="reply"
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
          <Button type="submit" size="lg" aria-busy={sending === "turn"} aria-disabled={waiting !== null} className="h-12 w-full text-base sm:w-fit">
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
          <Button type="button" variant="outline" size="lg" onClick={conclude} aria-busy={waiting === "conclusion"} aria-disabled={waiting !== null} className="w-full sm:w-fit">
            {waiting === "conclusion" ? "Préparation…" : "J'accepte ces termes"}
          </Button>
        </div>
      ) : null}

      {error ? <ThreadError message={error} /> : null}
    </section>
  );
}
