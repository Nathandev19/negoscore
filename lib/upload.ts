export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_TYPES = {
  photo: ["image/jpeg", "image/png", "image/webp"],
  pdf: ["application/pdf"],
} as const;

export type FileKind = keyof typeof ACCEPTED_TYPES;

export function validateFile(file: File, kind: FileKind): string | null {
  const accepted: readonly string[] = ACCEPTED_TYPES[kind];
  if (!accepted.includes(file.type)) {
    return kind === "photo"
      ? "Ce fichier n'est pas une image JPG, PNG ou WebP."
      : "Ce fichier n'est pas un PDF.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Ce fichier dépasse 10 Mo.";
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
