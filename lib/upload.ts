export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Limites des PDF (partagées par l'interface et le serveur).
//
// - taille : 10 Mo, la limite du bucket de dépôt ; le fournisseur accepte
//   jusqu'à 50 Mo par fichier ;
// - pages : 20. Le fournisseur ne fixe pas de plafond de pages, mais chaque
//   page est envoyée au modèle en texte ET en image : au-delà, l'analyse
//   devient lente (délai de 55 s par appel) et coûteuse, pour un brief ou un
//   contrat UGC qui tient en quelques pages.
export const MAX_PDF_PAGES = 20;

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
