"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone, type SelectedFile } from "@/components/file-drop-zone";
import { LoadingSteps } from "@/components/loading-steps";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { validateFile, type FileKind } from "@/lib/upload";

const MIN_TEXT_LENGTH = 20;
const LOADING_DURATION_MS = 2500;
const LOADING_STEPS = ["Lecture du message", "Extraction du deal", "Analyse et chiffrage"] as const;
const GENERIC_ERROR = "L'analyse n'a pas abouti. Vérifie ta connexion et réessaie.";
const UPLOAD_ERROR = "Le fichier n'a pas pu être envoyé. Vérifie ta connexion et réessaie.";

type Mode = "text" | FileKind;
type Outcome = { ok: true; analysisId: string } | { ok: false; message: string };

class FlowError extends Error {}

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
  if (!response.ok) throw new FlowError(typeof body.error === "string" ? body.error : GENERIC_ERROR);
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
  const [notice, setNotice] = useState<string | null>(null);
  const outcomeRef = useRef<Outcome | null>(null);
  const stepsDoneRef = useRef(false);

  const textLength = text.trim().length;
  const canSubmit = mode === "text" ? textLength >= MIN_TEXT_LENGTH : files[mode] !== null;

  function selectFile(kind: FileKind, file: File) {
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
      setNotice(outcome.message);
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
    try {
      const selected = current === "text" ? null : files[current];
      const payload = selected && current !== "text" ? { storagePath: await uploadFile(current, selected.file) } : { text };
      const { analysisId } = await postJson("/api/analyse", payload);
      outcomeRef.current =
        typeof analysisId === "string" ? { ok: true, analysisId } : { ok: false, message: GENERIC_ERROR };
    } catch (caught) {
      outcomeRef.current = { ok: false, message: caught instanceof FlowError ? caught.message : GENERIC_ERROR };
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
            onChange={(event) => setText(event.target.value)}
            placeholder="Colle ici le DM, le mail ou le brief de la marque…"
            aria-label="Message de la marque"
            className="min-h-40 resize-y bg-white text-base md:text-base"
          />
          <p className="text-right text-sm text-neutral-500" aria-live="polite">
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
        <p role="alert" className="text-sm font-medium text-red-700">
          {notice}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={!canSubmit} className="h-12 w-full text-base">
        Analyser mon deal
      </Button>
    </form>
  );
}
