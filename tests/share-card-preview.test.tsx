import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShareCardLink } from "@/components/result/share-card-link";
import { TierContext } from "@/components/result/tier-selector";

// Mission #064, partie B — la carte est vue avant d'être enregistrée.
// Pas d'environnement DOM dans ce dépôt : le rendu initial est vérifié ici,
// et le parcours (clic, attente, affichage, échec, nouvel essai) l'a été dans
// le navigateur sur /dev/resultat.

const source = readFileSync(path.join(process.cwd(), "components/result/share-card-link.tsx"), "utf8").replace(/\r\n/g, "\n");
const html = renderToStaticMarkup(
  <TierContext value="starter">
    <ShareCardLink href="/analyse/resultat/abc/carte" />
  </TierContext>,
);

describe("carte partageable — avant le clic", () => {
  it("un seul bouton « Voir ma carte », aucune image, aucun téléchargement", () => {
    expect(html).toContain("Voir ma carte");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("download=");
    expect(html).not.toContain("data-card-placeholder");
  });

  it("aucune génération au chargement : la seule requête part du clic", () => {
    // Un seul fetch dans le composant, et il est dans le gestionnaire de clic,
    // pas dans un effet exécuté au montage.
    expect(source.match(/fetch\(/g)).toHaveLength(1);
    const generate = source.slice(source.indexOf("async function generate"), source.indexOf("return (\n    <section"));
    expect(generate).toContain("fetch(");
    const effects = source.match(/useEffect\([\s\S]*?\n  \);/g) ?? [];
    expect(effects.join("\n")).not.toContain("fetch");
  });
});

describe("carte partageable — ce qui est affiché est ce qui est enregistré", () => {
  it("l'image affichée et le lien d'enregistrement pointent sur le même fichier", () => {
    expect(source).toMatch(/<img\s+src=\{view\.url\}/);
    expect(source).toMatch(/<a href=\{view\.url\} download=\{SHARE_CARD_FILENAME\}>/);
  });

  it("proportion réelle 9:16, pour l'image comme pour l'attente", () => {
    expect(source).toMatch(/width=\{1080\}\s+height=\{1920\}/);
    expect(source.match(/aspect-\[9\/16\]/g)).toHaveLength(2);
  });

  it("le texte de remplacement ne nomme ni marque ni personne", () => {
    const alt = source.match(/alt="([^"]+)"/)?.[1] ?? "";
    expect(alt).toContain("sans le nom de la marque ni le tien");
  });

  it("un échec dit quoi faire et laisse le bouton cliquable", () => {
    expect(source).toContain("Réessaie dans un instant ; si ça recommence, recharge la page.");
    expect(source).toContain('"Réessayer"');
    // Le bouton n'est jamais « disabled » : il reste atteignable (mission #062, A12).
    expect(source).not.toMatch(/\sdisabled=\{/);
  });
});
