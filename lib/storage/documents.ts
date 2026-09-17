import { randomUUID } from "node:crypto";
import { ACCEPTED_TYPES, MAX_FILE_BYTES, type FileKind } from "@/lib/upload";

// Règles de dépôt des documents, partagées par /api/upload-url et /api/analyse.

export const DOCUMENT_TTL_DAYS = 30;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type AnnouncedFile = { kind: FileKind; mime: string; bytes: number };

export function validateAnnouncedFile(input: unknown): AnnouncedFile | { error: string } {
  const { kind, mime, bytes } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (kind !== "photo" && kind !== "pdf") return { error: "Choisis une photo ou un PDF." };
  const accepted: readonly string[] = ACCEPTED_TYPES[kind];
  if (typeof mime !== "string" || !accepted.includes(mime)) {
    return { error: kind === "photo" ? "Ce fichier n'est pas une image JPG, PNG ou WebP." : "Ce fichier n'est pas un PDF." };
  }
  // Deux causes réelles, deux messages (mission #062, D4). « Taille illisible »
  // ne disait rien à personne : ce n'est pas le fichier qui est illisible.
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
    return { error: "La taille du fichier n'a pas été transmise. Recharge la page et choisis le fichier à nouveau." };
  }
  if (bytes === 0) {
    return { error: "Ce fichier est vide : il ne contient aucune donnée. Choisis un autre fichier." };
  }
  if (bytes > MAX_FILE_BYTES) return { error: "Ce fichier dépasse 10 Mo." };
  return { kind, mime, bytes };
}

// Chemin non devinable : dossier et nom de fichier sont deux UUID v4 aléatoires.
export function newStoragePath(mime: string): string {
  return `${randomUUID()}/${randomUUID()}.${EXTENSIONS[mime] ?? "bin"}`;
}

const STORAGE_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

export function isStoragePath(value: string): boolean {
  return STORAGE_PATH.test(value);
}

// Type réel du fichier, lu dans ses premiers octets : le type annoncé par le
// navigateur ne suffit pas.
export function sniffMime(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}
