import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerdictCardShare } from "@/components/result/verdict-card-share";

// Mission #064, partie B — la carte est vue avant d'être enregistrée.
// Pas d'environnement DOM dans ce dépôt : le rendu initial est vérifié ici,
// et le parcours (clic, attente, affichage, échec, nouvel essai) l'a été dans
// le navigateur sur /dev/resultat.
//
// Mission #169 — le composant de la #064 (ShareCardLink) a disparu avec sa
// route. Les règles qu'il portait, elles, valent pour le bouton qui reste :
// elles sont reportées ici sur VerdictCardShare, sans en perdre une. Un test
// qui disparaît avec un composant est une régression, pas un nettoyage.

const source = readFileSync(path.join(process.cwd(), "components/result/verdict-card-share.tsx"), "utf8").replace(/\r\n/g, "\n");
const html = renderToStaticMarkup(<VerdictCardShare href="/api/carte/abc" />);

describe("carte partageable — avant le clic", () => {
  it("un seul bouton « Voir ma carte », aucune image, aucun téléchargement", () => {
    expect(html).toContain("Voir ma carte");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("download=");
  });

  it("aucune génération au chargement : la seule requête part du clic", () => {
    // Un seul fetch pour la carte, et il est dans le gestionnaire de clic, pas
    // dans un effet exécuté au montage. Chaque vue paierait sinon un rendu
    // d'image pour des gens qui ne partageront pas (règle posée en #064).
    const generate = source.slice(source.indexOf("async function preparer"), source.indexOf("return ("));
    expect(generate).toContain("fetch(href");
    const effects = source.match(/useEffect\([\s\S]*?\n  \);/g) ?? [];
    expect(effects.join("\n")).not.toContain("fetch");
    expect(effects.join("\n")).not.toContain("preparer");
  });
});

describe("carte partageable — ce qui est affiché est ce qui est enregistré", () => {
  it("l'image affichée et le fichier partagé sont le même objet", () => {
    // Pas deux requêtes, pas deux rendus : le blob récupéré sert à la fois à
    // l'aperçu et au partage. Elle voit exactement ce qui sort.
    expect(source).toMatch(/<img\s+src=\{etat\.url\}/);
    expect(source).toContain("const url = URL.createObjectURL(blob)");
    expect(source).toContain("setEtat({ kind: \"prete\", url, fichier })");
    expect(source).toMatch(/download=\{VERDICT_CARD_FILENAME\}/);
  });

  it("proportion réelle 4:5, celle de la carte", () => {
    expect(source).toContain("width={VERDICT_CARD_SIZE.width}");
    expect(source).toContain("height={VERDICT_CARD_SIZE.height}");
    expect(source).toContain("aspect-[4/5]");
  });

  it("le texte de remplacement ne nomme ni marque ni personne", () => {
    const alt = source.match(/alt="([^"]+)"/)?.[1] ?? "";
    expect(alt).toContain("sans le nom de la marque ni le tien");
  });

  it("un échec dit quoi faire et laisse le bouton cliquable", () => {
    expect(source).toContain("Réessaie dans un instant ; si ça recommence, recharge la page.");
    expect(source).toContain('"Réessayer"');
    // Mission #062, A12 — après un échec le bouton reste atteignable. Le seul
    // cas où il est désactivé est « indisponible », qui n'est pas une panne
    // mais un refus définitif : il n'y a pas de carte pour cette analyse, et
    // réessayer ne changerait rien.
    const disabled = source.match(/(?<!aria-)disabled=\{[^}]+\}/g) ?? [];
    expect(disabled).toEqual(['disabled={etat.kind === "indisponible"}']);
    // « chargement » et « erreur » n'en font pas partie : on peut toujours
    // recliquer.
    expect(disabled.join()).not.toContain("erreur");
    expect(disabled.join()).not.toContain("chargement");
  });
});
