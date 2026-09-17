import { inflateSync } from "node:zlib";
import { MAX_FILE_BYTES, MAX_PDF_PAGES } from "@/lib/upload";

// Contrôles d'un PDF avant de l'envoyer au modèle, sans dépendance. Limites
// retenues et leur justification : lib/upload.ts.
export const MAX_PDF_BYTES = MAX_FILE_BYTES;
export { MAX_PDF_PAGES };

export type PdfCheck = { ok: true; pages: number } | { ok: false; reason: PdfRefusal; message: string };
export type PdfRefusal = "not_pdf" | "too_large" | "empty" | "too_many_pages" | "encrypted" | "unreadable";

export const PDF_REFUSAL_MESSAGE: Record<PdfRefusal, string> = {
  not_pdf: "Ce fichier n'est pas un PDF. Dépose un PDF, ou colle le texte de l'offre.",
  too_large: "Ce PDF dépasse 10 Mo. Envoie seulement les pages de l'offre, ou colle son texte.",
  empty: "Ce PDF ne contient aucune page. Vérifie le fichier, ou colle le texte de l'offre.",
  too_many_pages: `Ce PDF dépasse ${MAX_PDF_PAGES} pages. Envoie seulement les pages de l'offre, ou colle son texte.`,
  encrypted: "Ce PDF est protégé par un mot de passe. Enregistre-le sans protection, ou fais une capture d'écran.",
  unreadable: "Ce PDF est illisible ou endommagé. Fais une capture d'écran de l'offre, ou colle son texte.",
};

function refuse(reason: PdfRefusal): PdfCheck {
  return { ok: false, reason, message: PDF_REFUSAL_MESSAGE[reason] };
}

// Nombre de pages : /Count du nœud racine /Type /Pages, lu en clair et dans
// les flux compressés (objets regroupés en /ObjStm). Le plus grand /Count est
// celui de la racine de l'arbre des pages.
export function countPdfPages(bytes: Uint8Array): number | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sources = [buffer.toString("latin1")];
  const raw = sources[0];
  const streamPattern = /stream\r?\n/g;
  for (let match = streamPattern.exec(raw); match; match = streamPattern.exec(raw)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    try {
      sources.push(inflateSync(buffer.subarray(start, end)).toString("latin1"));
    } catch {
      // flux non compressé en Flate, ou image : ignoré
    }
    streamPattern.lastIndex = end;
  }
  let count: number | null = null;
  for (const source of sources) {
    for (const dict of source.matchAll(/<<(?:[^<>]|<<[^<>]*>>)*>>/g)) {
      if (!/\/Type\s*\/Pages\b/.test(dict[0])) continue;
      const found = dict[0].match(/\/Count\s+(\d+)/);
      if (found) count = Math.max(count ?? 0, Number(found[1]));
    }
  }
  return count;
}

export function inspectPdf(bytes: Uint8Array): PdfCheck {
  if (bytes.byteLength > MAX_PDF_BYTES) return refuse("too_large");
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (head !== "%PDF-") return refuse("not_pdf");
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(text)) return refuse("encrypted");
  const pages = countPdfPages(bytes);
  if (pages === null) return refuse("unreadable");
  if (pages === 0) return refuse("empty");
  if (pages > MAX_PDF_PAGES) return refuse("too_many_pages");
  return { ok: true, pages };
}
