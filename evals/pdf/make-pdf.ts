// Fabrique un PDF valide, sans dépendance, pour les fixtures et les tests :
// une page par entrée de `pages`, chaque page étant une liste de lignes en
// Helvetica. Les caractères accentués passent par WinAnsiEncoding.

function winAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    const mapped = code === 0x20ac ? 0x80 : code === 0x2019 ? 0x92 : code < 256 ? code : 63;
    if (mapped === 0x28 || mapped === 0x29 || mapped === 0x5c) out += `\\${String.fromCharCode(mapped)}`;
    else if (mapped < 32 || mapped > 126) out += `\\${mapped.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(mapped);
  }
  return out;
}

export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // numéro d'objet (1-based)

  const catalog = add(""); // rempli plus bas
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const lines of pages) {
    const stream = ["BT", "/F1 11 Tf", "14 TL", "56 780 Td", ...lines.map((line) => `(${winAnsi(line)}) Tj T*`), "ET"].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}

// Offre courte d'une page, utilisée comme fixture PDF.
export const OFFER_PDF_LINES = [
  "PROPOSITION DE COLLABORATION - MAISON ORTIE",
  "",
  "Bonjour,",
  "",
  "La marque Maison Ortie (bougies naturelles) souhaite collaborer avec toi.",
  "",
  "Livrables : 2 vidéos TikTok UGC de 30 secondes, non publiées sur ton compte.",
  "Droits : publicité payante pendant 6 mois, en France.",
  "Exclusivité : 3 mois sur la catégorie bougies et parfums d'intérieur.",
  "Rushs bruts à fournir. 2 séries de retours maximum.",
  "Rémunération : 450 € HT pour l'ensemble.",
  "Paiement : 30 jours après la livraison des vidéos.",
  "",
  "Merci de nous confirmer ton accord.",
  "Camille, Maison Ortie",
];
