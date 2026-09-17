"use client";

import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDropZone, type SelectedFile } from "@/components/file-drop-zone";
import { LoadingSteps } from "@/components/loading-steps";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { validateFile, type FileKind } from "@/lib/upload";

const MIN_TEXT_LENGTH = 20;
const LOADING_DURATION_MS = 2500;
const LOADING_STEPS = ["Lecture du message", "Extraction du deal", "Analyse et chiffrage"] as const;
const GENERIC_ERROR = "L'analyse n'a pas abouti. Vérifie ta connexion et réessaie.";
const UPLOAD_ERROR = "Le fichier n'a pas pu être envoyé. Vérifie ta connexion et réessaie.";
const METHOD = { text: "paste", photo: "photo", pdf: "pdf" } as const;

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
    throw new FlowError(typeof body.error === "string" ? body.error : GENERIC_ERROR, response.status === 402, reason);
  }
  return body;
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

export function DealInput() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Record<FileKind, SelectedFile | null>>({
    photo: null,
    pdf: null,
  });
  const [errors, setErrors] = useState<Record<FileKind, string | null>>({
    photo: null,
    pdf: null,
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ message: string; paywall: boolean; signIn: boolean } | null>(null);
  const outcomeRef = useRef<Outcome | null>(null);
  const stepsDoneRef = useRef(false);
  const startedRef = useRef<Record<Mode, boolean>>({ text: false, photo: false, pdf: false });

  const textLength = text.trim().length;
  const canSubmit = mode === "text" ? textLength >= MIN_TEXT_LENGTH : files[mode] !== null;
  const reasonId = useId();
  // Bouton désactivé : on dit pourquoi, à l'écran et au lecteur d'écran.
  const disabledReason =
    mode === "text" ? `${MIN_TEXT_LENGTH} caractères minimum` : mode === "photo" ? "Ajoute une photo" : "Ajoute un PDF";

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

  // On affiche le résultat quand l'analyse est revenue ET que les étapes
  // de chargement ont défilé, dans n'importe quel ordre.
  const finish = useCallback(() => {
    const outcome = outcomeRef.current;
    if (!outcome || !stepsDoneRef.current) return;
    if (outcome.ok) {
      router.push(`/analyse/resultat/${outcome.analysisId}`);
    } else {
      setNotice({ message: outcome.message, paywall: outcome.paywall, signIn: outcome.signIn });
      setLoading(false);
    }
  }, [router]);

  const onStepsDone = useCallback(() => {
    stepsDoneRef.current = true;
    finish();
  }, [finish]);

  async function analyse(current: Mode) {
    outcomeRef.current = null;
    stepsDoneRef.current = false;
    setNotice(null);
    setLoading(true);
    const method = METHOD[current];
    track(ANALYTICS_EVENTS.analysisSubmitted, { method });
    try {
      const selected = current === "text" ? null : files[current];
      const payload = selected && current !== "text" ? { storagePath: await uploadFile(current, selected.file) } : { text };
      const { analysisId, meta } = await postJson("/api/analyse", payload);
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
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white px-6">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <p className="text-2xl font-bold tracking-tight">On analyse ton deal</p>
          <LoadingSteps steps={LOADING_STEPS} durationMs={LOADING_DURATION_MS} onDone={onStepsDone} />
        </div>
      </div>
    );
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
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as Mode);
          setNotice(null);
        }}
      >
        <TabsList className="grid h-10 w-full grid-cols-3">
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
            className="min-h-40 resize-y bg-surface text-base md:text-base"
          />
          <p className="text-right text-small text-subtle tabular-nums" aria-live="polite">
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
        <div role="alert" className="flex flex-col gap-2 text-sm font-medium text-red-700">
          <p>{notice.message}</p>
          {notice.signIn ? (
            <p>
              <Link href="/connexion?next=%2Fanalyse" className="font-semibold text-neutral-950 underline">
                Me connecter
              </Link>
            </p>
          ) : null}
          {notice.paywall ? (
            <p className="flex gap-4">
              <Link href="/offres" className="font-semibold text-neutral-950 underline">
                Voir les offres
              </Link>
              <Link href="/connexion?next=%2Fanalyse" className="font-semibold text-neutral-950 underline">
                Me connecter
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={!canSubmit}
        aria-describedby={canSubmit ? undefined : reasonId}
        className="h-12 w-full text-base font-semibold disabled:border disabled:border-line disabled:bg-surface-soft disabled:text-copy disabled:opacity-100"
      >
        Analyser mon deal
      </Button>
      {canSubmit ? null : (
        <p id={reasonId} className="text-center text-small text-subtle">
          {disabledReason}
        </p>
      )}
    </form>
  );
}
