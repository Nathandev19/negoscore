import { inflateSync } from "node:zlib";

// Mission #168 — DÉCODEUR PNG MINIMAL, pour MESURER les cartes rendues.
//
// Il n'existe aucune dépendance d'image dans ce dépôt, et il n'y a aucune
// raison d'en ajouter une pour des tests : zlib est dans Node, et un PNG
// RGBA non entrelacé se défiltre en trente lignes. Sert à vérifier sur
// l'image elle-même ce qu'aucun test de texte ne peut dire — que le pied de
// page est entier et que la fourchette tient sur une ligne.
//
// Décodeur PNG minimal : RGBA 8 bits, non entrelacé — ce que rend resvg via
// next/og. Sert à MESURER les rendus (étendue d'encre, marges) au lieu de les
// estimer à l'œil.
export type Image = { width: number; height: number; channels: number; data: Buffer };
export type Zone = { x0: number; y0: number; x1: number; y1: number };
export type Bornes = { minX: number; maxX: number; minY: number; maxY: number; largeur: number; hauteur: number };

export function decodePng(buffer: Buffer): Image {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("pas un PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (depth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`format inattendu: depth ${depth}, type ${colorType}`);
      if (data[12] !== 0) throw new Error("PNG entrelacé");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= channels && prev ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// Colonnes et lignes où l'image diffère de la couleur de fond donnée.
// `fond` : [r, g, b]. `tolerance` : écart maximal par canal pour être « du fond ».
export function inkBounds(image: Image, fond: readonly [number, number, number], tolerance = 12, zone: Zone | null = null): Bornes | null {
  const { width, height, channels, data } = image;
  const x0 = zone?.x0 ?? 0;
  const y0 = zone?.y0 ?? 0;
  const x1 = zone?.x1 ?? width;
  const y1 = zone?.y1 ?? height;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      if (
        Math.abs(data[i] - fond[0]) <= tolerance &&
        Math.abs(data[i + 1] - fond[1]) <= tolerance &&
        Math.abs(data[i + 2] - fond[2]) <= tolerance
      )
        continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, maxX, minY, maxY, largeur: maxX - minX + 1, hauteur: maxY - minY + 1 };
}

// Bandes horizontales d'encre : les groupes de lignes consécutives qui
// contiennent au moins un pixel différent du fond. Sert à compter les lignes
// de texte d'un bloc.
export function rowBands(
  image: Image,
  fond: readonly [number, number, number],
  tolerance = 12,
  zone: Zone | null = null,
): Array<{ y0: number; y1: number; hauteur: number }> {
  const { width, height, channels, data } = image;
  const x0 = zone?.x0 ?? 0;
  const y0 = zone?.y0 ?? 0;
  const x1 = zone?.x1 ?? width;
  const y1 = zone?.y1 ?? height;
  const bands: Array<{ y0: number; y1: number; hauteur: number }> = [];
  let debut = -1;
  for (let y = y0; y < y1; y++) {
    let encre = false;
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      if (
        Math.abs(data[i] - fond[0]) > tolerance ||
        Math.abs(data[i + 1] - fond[1]) > tolerance ||
        Math.abs(data[i + 2] - fond[2]) > tolerance
      ) {
        encre = true;
        break;
      }
    }
    if (encre && debut < 0) debut = y;
    else if (!encre && debut >= 0) {
      bands.push({ y0: debut, y1: y - 1, hauteur: y - debut });
      debut = -1;
    }
  }
  if (debut >= 0) bands.push({ y0: debut, y1: y1 - 1, hauteur: y1 - debut });
  return bands;
}
