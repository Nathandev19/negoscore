import { readFile } from "node:fs/promises";
import path from "node:path";

// satori, qui motorise ImageResponse, plante sur la police variable de
// Bricolage Grotesque (« Cannot read properties of undefined (reading '256') »,
// essai du 17/09/2026). La carte embarque donc deux fichiers à graisse fixe,
// pour cette route seulement : Bricolage Grotesque 800 et Familjen Grotesk 600.
// Le site, lui, garde les polices variables de next/font.
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

let fonts: Promise<Array<{ name: string; data: Buffer; weight: 600 | 800; style: "normal" }>> | null = null;

// Exporté : le logo des emails (app/dev/logo-email) utilise la même police.
export function loadFonts() {
  fonts ??= Promise.all([
    readFile(path.join(FONT_DIR, "BricolageGrotesque-ExtraBold.ttf")),
    readFile(path.join(FONT_DIR, "FamiljenGrotesk-SemiBold.ttf")),
  ]).then(([bricolage, familjen]) => [
    { name: "Bricolage Grotesque", data: bricolage, weight: 800 as const, style: "normal" as const },
    { name: "Familjen Grotesk", data: familjen, weight: 600 as const, style: "normal" as const },
  ]);
  return fonts;
}
