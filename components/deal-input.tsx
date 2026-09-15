"use client";

import { useCallback, useState } from "react";
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

type Mode = "text" | FileKind;

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

  const goToResult = useCallback(() => router.push("/analyse/demo"), [router]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white px-6">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <p className="text-2xl font-bold tracking-tight">On analyse ton deal</p>
          <LoadingSteps
            steps={LOADING_STEPS}
            durationMs={LOADING_DURATION_MS}
            onDone={goToResult}
          />
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) setLoading(true);
      }}
    >
      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
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

      <Button type="submit" size="lg" disabled={!canSubmit} className="h-12 w-full text-base">
        Analyser mon deal
      </Button>
    </form>
  );
}
