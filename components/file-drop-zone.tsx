"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { FileTextIcon, ImageIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPTED_TYPES, formatFileSize, MAX_PDF_PAGES, type FileKind } from "@/lib/upload";
import { cn } from "@/lib/utils";

export type SelectedFile = { file: File; previewUrl: string | null };

type FileDropZoneProps = {
  kind: FileKind;
  selected: SelectedFile | null;
  error: string | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
};

const COPY: Record<FileKind, { title: string; hint: string }> = {
  photo: {
    title: "Dépose une capture du message",
    hint: "JPG, PNG ou WebP · 10 Mo max",
  },
  pdf: {
    title: "Dépose le brief ou le contrat",
    hint: `PDF · 10 Mo et ${MAX_PDF_PAGES} pages max`,
  },
};

export function FileDropZone({ kind, selected, error, onSelect, onRemove }: FileDropZoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const Icon = kind === "photo" ? ImageIcon : FileTextIcon;

  if (selected) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-3">
        {selected.previewUrl ? (
          <div className="relative h-44 w-full overflow-hidden rounded-lg bg-neutral-100">
            <Image
              src={selected.previewUrl}
              alt="Aperçu de ta capture"
              fill
              unoptimized
              className="object-contain"
            />
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <Icon className="size-5 shrink-0 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{selected.file.name}</p>
            <p className="text-xs text-neutral-500">{formatFileSize(selected.file.size)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <XIcon />
            Retirer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) onSelect(file);
        }}
        className={cn(
          "flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white px-4 text-center transition-colors",
          dragging ? "border-neutral-900 bg-neutral-50" : "border-neutral-300",
        )}
      >
        <Icon className="size-7 text-neutral-500" />
        <span className="text-base font-medium">{COPY[kind].title}</span>
        <span className="text-sm text-neutral-500">
          Touche pour choisir un fichier · {COPY[kind].hint}
        </span>
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPTED_TYPES[kind].join(",")}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onSelect(file);
          event.currentTarget.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
