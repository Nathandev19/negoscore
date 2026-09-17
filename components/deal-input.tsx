"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDropZone, type SelectedFile } from "@/components/file-drop-zone";
import { REVEAL_TOTAL_MS, WaitingScreen } from "@/components/loading-steps";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ANALYSIS_PAUSED_MESSAGE } from "@/lib/analysis/pause";
import { track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { hasSessionHint } from "@/lib/auth/session-hint";
import { hasNoFreeRightHint, rightView } from "@/lib/billing/right-hint";
import { clearDraft, readDraft, saveDraft, subscribeDraft } from "@/lib/draft";
import { clearPendingKey, pendingKey } from "@/lib/analysis/pending-key";
import { validateFile, type FileKind } from "@/lib/upload";

const MIN_TEXT_LENGTH = 20;
// Message d'échec (mission #060) : il ne promet plus que rien n'a été
// décompté — l'analyse a pu aboutir côté serveur sans nous parvenir. Relancer
// avec le même bouton rejoue la MÊME clé : si elle était partie, le résultat
// revient sans rien décompter de plus.
const GENERIC_ERROR =
  "L'analyse n'a pas abouti. Vérifie ta connexion, puis appuie de nouveau sur « Analyser mon deal » : si elle était déjà partie, tu retrouves ton résultat sans rien payer de plus.";
// Réponse du serveur sans message exploitable (coupure, délai de l'hébergeur) :
// ce n'est pas la connexion de l'utilisateur qui est en cause.
const SERVER_ERROR = "L'analyse est momentanément indisponible. Rien n'a été décompté, réessaie dans quelques minutes.";
const UPLOAD_ERROR = "Le fichier n'a pas pu être envoyé. Vérifie ta connexion et réessaie.";
const METHOD = { text: "paste", photo: "photo", pdf: "pdf" } as const;
// Copié au build depuis ANALYSIS_PAUSED (next.config.ts).
const PAUSED = process.env.NEXT_PUBLIC_ANALYSIS_PAUSED === "1";

type Mode = "text" | FileKind;
type AnalysisMeta = { latency_ms: number; confidence: string; score_band: string; has_price: boolean };
type Outcome =
  | { ok: true; analysisId: string }
  | { ok: false; message: string; paywall: boolean; signIn: boolean };

class FlowError extends Error {
  constructor(
    message: string,
    readonly paywall = false,
    readonly reason = "erreur",
  ) {
    super(message);
  }
}

async function postJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // réponse non JSON
  }
  if (!response.ok) {
    const reason = typeof body.reason === "string" ? body.reason : `http_${response.status}`;
    const fallback = response.status >= 500 ? SERVER_ERROR : GENERIC_ERROR;
    throw new FlowError(typeof body.error === "string" ? body.error : fallback, response.status === 402, reason);
  }
  return body;
}

// Reprise automatique d'une requête perdue en route (mission #060). Seules les
// coupures réseau sont rejouées : une réponse du serveur, même en erreur, est
// une décision et ne se rejoue pas. La clé d'idempotence étant la même, une
// analyse déjà produite est simplement rendue.
const RETRY_DELAY_MS = 1500;

async function withNetworkRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (caught) {
    if (caught instanceof FlowError) throw caught;
    await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
    return call();
  }
}

// Photo ou PDF : URL signée demandée au serveur, dépôt direct dans le stockage,
// puis analyse à partir du chemin du fichier.
async function uploadFile(kind: FileKind, file: File): Promise<string> {
  const { uploadUrl, storagePath } = await postJson("/api/upload-url", { kind, mime: file.type, bytes: file.size });
  if (typeof uploadUrl !== "string" || typeof storagePath !== "string") throw new FlowError(UPLOAD_ERROR);
  let uploaded: Response;
  try {
    uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
  } catch {
    throw new FlowError(UPLOAD_ERROR);
  }
  if (!uploaded.ok) throw new FlowError(UPLOAD_ERROR);
  return storagePath;
}

// Les cookies indicateurs ne changent qu'avec un chargement de page ou une
// réponse du serveur, suivie ici par l'état « refused ».
const noSubscription = () => () => undefined;

// Reste-t-il un droit ? Affiché AVANT la saisie (mission #046), sans appel
// serveur pour un visiteur sans compte. Voir lib/billing/right-hint.ts.
export function NoRightNotice({ message, offerSignIn }: { message: string; offerSignIn: boolean }) {
  return (
    <div role="status" data-no-right className="flex flex-col gap-3 border-l-4 border-encre py-1 pl-3">
      <p className="font-semibold text-encre">{message}</p>
      <p className="text-small">Le texte que tu colles reste gardé dans ce navigateur : tu le retrouveras en revenant.</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/tarifs">Voir les tarifs</Link>
        </Button>
        {offerSignIn ? (
          <Link href="/connexion?next=%2Fanalyse" className="link font-semibold">
            Me connecter
          </Link>
        ) : null}
      </div>
    </div>
  );
}

// note : phrase affichée sous le formulaire, sauf quand il ne reste aucun droit.
export function DealInput({ note }: { note?: string } = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  // Texte : le brouillon gardé dans le navigateur tant que rien n'a été tapé
  // ici, puis ce qui est tapé. Jamais perdu après un refus (lib/draft.ts).
  const [edited, setEdited] = useState<string | null>(null);
  const draft = useSyncExternalStore(subscribeDraft, () => readDraft(), () => "");
  const text = edited ?? draft;
  function setText(value: string) {
    setEdited(value);
    saveDraft(value);
  }
  const signedIn = useSyncExternalStore(noSubscription, () => hasSessionHint(document.cookie), () => false);
  const anonUsed = useSyncExternalStore(noSubscription, () => hasNoFreeRightHint(document.cookie), () => false);
  const [account, setAccount] = useState<{ allowed: boolean; message?: string } | null>(null);
  const [refused, setRefused] = useState<{ message: string } | null>(null);
  const right = rightView({ refused, signedIn, account, anonUsed });

  // Compte connecté : une lecture du droit, sans rien réserver (/api/droits).
  useEffect(() => {
    if (!signedIn) return;
    let stale = false;
    fetch("/api/droits", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ allowed?: unknown; message?: unknown }>)
      .then((value) => {
        if (stale || typeof value.allowed !== "boolean") return;
        setAccount({ allowed: value.allowed, message: typeof value.message === "string" ? value.message : undefined });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [signedIn]);
  const [files, setFiles] = useState<Record<FileKind, SelectedFile | null>>({
    photo: null,
    pdf: null,
  });
  const [errors, setErrors] = useState<Record<FileKind, string | null>>({
    photo: null,
    pdf: null,
  });
  const [loading, setLoading] = useState(false);
  // Moment de la réponse du serveur : les étapes après la lecture ne se cochent
  // qu'à partir de là. null tant que l'appel est en cours.
  const [respondedAt, setRespondedAt] = useState<number | null>(null);
  // Mode de l'analyse en cours (le libellé de lecture en dépend).
  const [runningMode, setRunningMode] = useState<Mode>("text");
  const [notice, setNotice] = useState<{ message: string; paywall: boolean; signIn: boolean } | null>(null);
  const outcomeRef = useRef<Outcome | null>(null);
  const startedRef = useRef<Record<Mode, boolean>>({ text: false, photo: false, pdf: false });

  const textLength = text.trim().length;
  const canSubmit = !PAUSED && (mode === "text" ? textLength >= MIN_TEXT_LENGTH : files[mode] !== null);
  const reasonId = useId();
  // Bouton désactivé : on dit pourquoi, à l'écran et au lecteur d'écran.
  const disabledReason = PAUSED
    ? "Analyse momentanément indisponible"
    : mode === "text" ? `${MIN_TEXT_LENGTH} caractères minimum` : mode === "photo" ? "Ajoute une photo" : "Ajoute un PDF";

  // Émis une seule fois par mode, au premier geste réel de l'utilisateur.
  function markInputStarted(current: Mode) {
    if (startedRef.current[current]) return;
    startedRef.current[current] = true;
    track(ANALYTICS_EVENTS.inputStarted, { method: METHOD[current] });
  }

  function selectFile(kind: FileKind, file: File) {
    markInputStarted(kind);
    const error = validateFile(file, kind);
    setErrors((prev) => ({ ...prev, [kind]: error }));
    if (error) return;
    removeFile(kind);
    const previewUrl = kind === "photo" ? URL.createObjectURL(file) : null;
    setFiles((prev) => ({ ...prev, [kind]: { file, previewUrl } }));
  }

  function removeFile(kind: FileKind) {
    const previewUrl = files[kind]?.previewUrl;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFiles((prev) => ({ ...prev, [kind]: null }));
  }

  // L'écran d'attente reste affiché jusqu'à la réponse réelle, puis le temps de
  // cocher les étapes restantes (REVEAL_TOTAL_MS), et pas plus.
  function finish() {
    const outcome = outcomeRef.current;
    if (!outcome) return;
    if (outcome.ok) {
      // La réponse est là : les étapes restantes se cochent, puis le résultat s'affiche.
      setRespondedAt(Date.now());
      clearDraft();
      // Résultat acquis : il n'y a plus rien à rejouer (mission #060).
      clearPendingKey("analyse");
      const target = `/analyse/resultat/${outcome.analysisId}`;
      window.setTimeout(() => router.push(target), REVEAL_TOTAL_MS);
    } else if (outcome.paywall) {
      // Plus de droit : l'action principale devient « Voir les tarifs », le texte reste.
      setRefused({ message: outcome.message });
      setLoading(false);
    } else {
      setNotice({ message: outcome.message, paywall: false, signIn: outcome.signIn });
      setLoading(false);
    }
  }

  async function analyse(current: Mode) {
    outcomeRef.current = null;
    setNotice(null);
    setRespondedAt(null);
    setRunningMode(current);
    setLoading(true);
    const method = METHOD[current];
    track(ANALYTICS_EVENTS.analysisSubmitted, { method });
    try {
      const selected = current === "text" ? null : files[current];
      const source = selected && current !== "text" ? { storagePath: await uploadFile(current, selected.file) } : { text };
      // Clé gardée par le navigateur : la reprise ci-dessous et un nouvel appui
      // sur le bouton renvoient la même, et le serveur rend alors le résultat
      // déjà produit au lieu d'en payer un second (mission #060).
      const payload = { ...source, idempotencyKey: pendingKey("analyse") };
      const { analysisId, meta } = await withNetworkRetry(() => postJson("/api/analyse", payload));
      if (typeof analysisId === "string") {
        const info = meta as AnalysisMeta | undefined;
        track(ANALYTICS_EVENTS.analysisCompleted, {
          method,
          latency_ms: info?.latency_ms ?? 0,
          confidence: info?.confidence ?? "inconnue",
          score_band: info?.score_band ?? "inconnu",
          has_price: info?.has_price ?? false,
        });
        outcomeRef.current = { ok: true, analysisId };
      } else {
        track(ANALYTICS_EVENTS.analysisFailed, { reason: "reponse_invalide" });
        outcomeRef.current = { ok: false, message: GENERIC_ERROR, paywall: false, signIn: false };
      }
    } catch (caught) {
      const failure =
        caught instanceof FlowError
          ? { ok: false as const, message: caught.message, paywall: caught.paywall, reason: caught.reason }
          : { ok: false as const, message: GENERIC_ERROR, paywall: false, reason: "reseau" };
      track(ANALYTICS_EVENTS.analysisFailed, { reason: failure.reason });
      if (failure.reason === "free_used") track(ANALYTICS_EVENTS.secondAnalysisAttempt, { method });
      outcomeRef.current = {
        ok: false,
        message: failure.message,
        paywall: failure.paywall,
        // Freinage réseau : le message invite à se connecter, pas à payer.
        signIn: failure.reason === "rate_limited",
      };
    }
    finish();
  }

  if (loading) {
    return <WaitingScreen kind={runningMode} respondedAt={respondedAt} />;
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        void analyse(mode);
      }}
    >
      {right.blocked ? <NoRightNotice message={right.message} offerSignIn={right.offerSignIn} /> : null}
      {PAUSED ? (
        <p role="status" className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
          {ANALYSIS_PAUSED_MESSAGE}
        </p>
      ) : null}
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as Mode);
          setNotice(null);
        }}
      >
        <TabsList className="grid h-11 w-full grid-cols-[1.6fr_1fr_1fr]">
          <TabsTrigger value="text">Coller le message</TabsTrigger>
          <TabsTrigger value="photo">Photo</TabsTrigger>
          <TabsTrigger value="pdf">PDF</TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="flex flex-col gap-1.5">
          <Textarea
            value={text}
            onChange={(event) => {
              markInputStarted("text");
              setText(event.target.value);
            }}
            placeholder="Colle ici le DM, le mail ou le brief de la marque…"
            aria-label="Message de la marque"
            className="min-h-40 resize-y"
          />
          <p className="text-right text-small text-attenue tabular-nums" aria-live="polite">
            {textLength < MIN_TEXT_LENGTH
              ? `${textLength} caractère${textLength > 1 ? "s" : ""} · ${MIN_TEXT_LENGTH} minimum`
              : `${textLength} caractères`}
          </p>
        </TabsContent>

        {(["photo", "pdf"] as const).map((kind) => (
          <TabsContent key={kind} value={kind}>
            <FileDropZone
              kind={kind}
              selected={files[kind]}
              error={errors[kind]}
              onSelect={(file) => selectFile(kind, file)}
              onRemove={() => removeFile(kind)}
            />
          </TabsContent>
        ))}
      </Tabs>

      {notice ? (
        <div role="alert" className="flex flex-col gap-2 alert-bad py-1 text-sm">
          <p>{notice.message}</p>
          {notice.signIn ? (
            <p>
              <Link href="/connexion?next=%2Fanalyse" className="link font-semibold">
                Me connecter
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        // Sans droit, le bouton d'analyse n'est plus l'action mise en avant. Il reste
        // utilisable : l'indicateur peut être en retard sur un achat, le serveur tranche.
        variant={right.blocked ? "outline" : "default"}
        disabled={!canSubmit}
        aria-describedby={canSubmit ? undefined : reasonId}
        className="h-12 w-full text-base"
      >
        Analyser mon deal
      </Button>
      {canSubmit ? null : (
        <p id={reasonId} className="text-center text-small text-attenue">
          {disabledReason}
        </p>
      )}
      {note && !right.blocked ? <p className="text-center text-small text-attenue">{note}</p> : null}
    </form>
  );
}
