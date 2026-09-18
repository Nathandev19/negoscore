import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/email/layout";

// Mission #063 — schéma de couleurs. Deux surfaces, deux règles voulues :
//   - le site déclare « only light » : sans le mot-clé « only », Chrome Android
//     peut assombrir la page lui-même et les contrastes vérifiés ne valent plus ;
//   - les e-mails déclarent « light dark » : ils ont un vrai thème sombre.

// app/layout.tsx charge next/font : on lit sa source plutôt que de l'importer.
const layout = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");

describe("schéma de couleurs du site", () => {
  it("le viewport déclare « only light »", () => {
    const viewport = layout.slice(layout.indexOf("export const viewport"), layout.indexOf("export default"));
    expect(viewport).toMatch(/colorScheme:\s*"only light"/);
  });
});

describe("schéma de couleurs des e-mails", () => {
  const html = renderEmail({
    subject: "Objet",
    preheader: "Aperçu",
    title: "Titre",
    blocks: [{ kind: "paragraph", text: "Bonjour." }],
    siteUrl: "https://exemple.test",
  });

  it("les e-mails gardent « light dark » et leur bloc sombre", () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("color-scheme: light dark");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
  });

  it("les e-mails ne passent jamais en « only light »", () => {
    expect(html).not.toMatch(/only\s+light/);
  });
});
