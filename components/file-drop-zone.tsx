"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { FileTextIcon, ImageIcon } from "lucide-react";
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
      <div className="flex flex-col gap-3 rounded-control border-2 border-encre p-3">
        {selected.previewUrl ? (
          <div className="relative h-44 w-full overflow-hidden bg-creme">
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
          <Icon className="size-5 shrink-0 text-attenue" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-encre">{selected.file.name}</p>
            <p className="text-xs text-attenue">{formatFileSize(selected.file.size)}</p>
          </div>
          <Button type="button" variant="link" size="sm" onClick={onRemove}>
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
          "flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed px-4 text-center transition-colors",
          dragging ? "border-marque" : "border-encre",
        )}
      >
        <span className="text-base font-medium text-encre">{COPY[kind].title}</span>
        <span className="text-sm text-attenue">
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
        <p role="alert" className="alert-bad py-1 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
