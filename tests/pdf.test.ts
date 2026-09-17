import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { makePdf, OFFER_PDF_LINES } from "@/evals/pdf/make-pdf";
import { sniffMime, validateAnnouncedFile } from "@/lib/storage/documents";
import { countPdfPages, inspectPdf, MAX_PDF_BYTES, MAX_PDF_PAGES, PDF_REFUSAL_MESSAGE } from "@/lib/storage/pdf";

const FIXTURE = path.join(process.cwd(), "evals", "fixtures-pdf", "p01-offre-bougies", "offre.pdf");

function pages(n: number): string[][] {
  return Array.from({ length: n }, (_, i) => [`Page ${i + 1}`]);
}

describe("PDF : contrôles avant l'appel au modèle", () => {
  it("la fixture est un vrai PDF d'une page, reconnu par ses octets", () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    expect(sniffMime(bytes)).toBe("application/pdf");
    expect(inspectPdf(bytes)).toEqual({ ok: true, pages: 1 });
    expect(bytes).toEqual(makePdf([OFFER_PDF_LINES]));
  });

  it("mauvais type : refusé, même annoncé comme PDF", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffMime(png)).toBe("image/png");
    expect(inspectPdf(png)).toMatchObject({ ok: false, reason: "not_pdf" });
    expect(inspectPdf(new TextEncoder().encode("<html>pas un pdf</html>"))).toMatchObject({ ok: false, reason: "not_pdf" });
    expect(validateAnnouncedFile({ kind: "pdf", mime: "image/png", bytes: 100 })).toHaveProperty("error");
  });

  it("trop lourd : refusé au-delà de 10 Mo, à l'annonce comme à la lecture", () => {
    expect(MAX_PDF_BYTES).toBe(10 * 1024 * 1024);
    const heavy = new Uint8Array(MAX_PDF_BYTES + 1);
    heavy.set(new TextEncoder().encode("%PDF-1.4"));
    expect(inspectPdf(heavy)).toMatchObject({ ok: false, reason: "too_large", message: PDF_REFUSAL_MESSAGE.too_large });
    expect(validateAnnouncedFile({ kind: "pdf", mime: "application/pdf", bytes: MAX_PDF_BYTES + 1 })).toHaveProperty("error");
  });

  it(`trop de pages : ${MAX_PDF_PAGES} acceptées, ${MAX_PDF_PAGES + 1} refusées`, () => {
    expect(inspectPdf(makePdf(pages(MAX_PDF_PAGES)))).toEqual({ ok: true, pages: MAX_PDF_PAGES });
    expect(inspectPdf(makePdf(pages(MAX_PDF_PAGES + 1)))).toMatchObject({ ok: false, reason: "too_many_pages" });
  });

  it("PDF vide : aucune page, ou aucun arbre de pages lisible", () => {
    expect(inspectPdf(makePdf([]))).toMatchObject({ ok: false, reason: "empty" });
    expect(inspectPdf(new TextEncoder().encode("%PDF-1.4\n%%EOF\n"))).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("compte les pages quand l'arbre est dans un flux compressé (/ObjStm)", () => {
    const inner = Buffer.from("<< /Type /Pages /Kids [4 0 R] /Count 37 >>", "latin1");
    const compressed = deflateSync(inner);
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /Length " + compressed.length + " >>\nstream\n", "latin1"),
      compressed,
      Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
    ]);
    expect(countPdfPages(new Uint8Array(pdf))).toBe(37);
    expect(inspectPdf(new Uint8Array(pdf))).toMatchObject({ ok: false, reason: "too_many_pages" });
  });

  it("PDF protégé par mot de passe : refusé avec un message clair", () => {
    const base = Buffer.from(makePdf(pages(1))).toString("latin1").replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 9 0 R");
    expect(inspectPdf(new Uint8Array(Buffer.from(base, "latin1")))).toMatchObject({ ok: false, reason: "encrypted" });
  });

  it("chaque refus a un message en français qui propose une autre voie", () => {
    for (const message of Object.values(PDF_REFUSAL_MESSAGE)) expect(message).toMatch(/capture|colle|PDF/);
  });
});
