import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mission #196 — AUCUN CARACTÈRE DE CONTRÔLE DANS LE DÉPÔT.
//
// Trois 0x08 ont été trouvés pendant la #195, tous trois un « \b » d'expression
// régulière mangé par un heredoc. Dans deux d'entre eux — anciens — une
// alternative entière du motif ne pouvait JAMAIS correspondre : la garde était
// à moitié morte, sans que rien ne le dise. C'est la pire espèce de défaut,
// invisible à la relecture parce que le caractère ne s'affiche pas.
//
// Le dépôt est propre. Ce test est là pour que le prochain ne passe pas.
//
// CE QUI EST BALAYÉ : les fichiers SUIVIS PAR GIT, et eux seuls. Ni
// node_modules, ni .next, ni les sorties de travail — git ne les suit pas, la
// question ne se pose pas.
//
// CE QUI EST EXCLU : les binaires, et c'est GIT qui le dit. « git ls-files
// --eol » marque « i/-text » les fichiers qu'il tient lui-même pour binaires
// (polices, PNG, ico). Aucune liste de noms n'est écrite ici : une exception
// par nom se discuterait, et celle-ci n'aurait pas lieu d'être.

// Les trois seuls caractères de contrôle qui ont un sens dans un fichier
// texte. Tout le reste de la zone C0 (0x00–0x1F) est une erreur.
const AUTORISES = new Set([0x09, 0x0a, 0x0d]);

const NOMS: Record<number, string> = {
  0x00: "NUL",
  0x07: "BEL",
  0x08: "BS, un « \\b » perdu dans un heredoc",
  0x0b: "VT",
  0x0c: "FF",
  0x1b: "ESC, probablement une séquence de couleur de terminal",
};

function interdit(octet: number): boolean {
  return octet <= 0x1f && !AUTORISES.has(octet);
}

// Les chemins suivis par git, binaires exclus par git lui-même. Le format de
// « --eol » est « i/… w/… attr/… » puis une TABULATION puis le chemin : on
// coupe à la tabulation, ce qui tient même pour un nom contenant des espaces.
function fichiersTexteSuivis(): string[] {
  const sortie = execFileSync("git", ["ls-files", "--eol"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return sortie
    .split("\n")
    .filter((ligne) => ligne.length > 0)
    .flatMap((ligne) => {
      const tabulation = ligne.indexOf("\t");
      if (tabulation === -1) return [];
      if (ligne.slice(0, tabulation).includes("i/-text")) return [];
      return [ligne.slice(tabulation + 1)];
    });
}

type Trouvaille = { fichier: string; ligne: number; colonne: number; octet: number };

// Lecture en OCTETS, pas en caractères : dans un texte UTF-8, un octet de la
// zone C0 ne peut être qu'un caractère de contrôle — les octets de
// continuation d'un caractère accentué valent 0x80 et plus. Chercher sur les
// octets est donc exact, et ne dépend d'aucun décodage.
function controlesDe(fichier: string): Trouvaille[] {
  const octets = readFileSync(fichier);
  const trouvailles: Trouvaille[] = [];
  let ligne = 1;
  let debutDeLigne = 0;
  for (let i = 0; i < octets.length; i += 1) {
    const octet = octets[i];
    if (octet === 0x0a) {
      ligne += 1;
      debutDeLigne = i + 1;
      continue;
    }
    if (!interdit(octet)) continue;
    // La colonne est comptée en CARACTÈRES, comme un éditeur l'affiche : on
    // décode le début de ligne plutôt que de compter les octets, sinon un
    // accent avant le fautif décalerait le repère.
    const colonne = octets.subarray(debutDeLigne, i).toString("utf8").length + 1;
    trouvailles.push({ fichier, ligne, colonne, octet });
  }
  return trouvailles;
}

function decrire({ fichier, ligne, colonne, octet }: Trouvaille): string {
  const code = `0x${octet.toString(16).padStart(2, "0")}`;
  const nom = NOMS[octet];
  return `${fichier}:${ligne}:${colonne} — caractère de contrôle ${code}${nom ? ` (${nom})` : ""}`;
}

describe("aucun caractère de contrôle dans les fichiers suivis", () => {
  const fichiers = fichiersTexteSuivis();

  it("le balayage porte sur le dépôt entier, pas sur une poignée de fichiers", () => {
    // Si « git ls-files » échouait ou ne rendait rien, le test passerait sans
    // rien vérifier. Ce garde-fou le refuse.
    expect(fichiers.length).toBeGreaterThan(100);
    // Et les binaires sont bien sortis par git, pas par un nom écrit ici.
    expect(fichiers.some((f) => f.endsWith(".png") || f.endsWith(".ttf") || f.endsWith(".ico"))).toBe(false);
  });

  it("ni tabulation, ni retour chariot, ni saut de ligne ne sont signalés", () => {
    // Les trois seuls autorisés. Sans ce test, resserrer la liste ferait
    // échouer le dépôt entier pour rien.
    for (const octet of [0x09, 0x0a, 0x0d]) expect(interdit(octet), `0x0${octet.toString(16)}`).toBe(false);
    // Et tout le reste de la zone C0 est refusé, y compris 0x00.
    for (const octet of [0x00, 0x08, 0x0b, 0x0c, 0x1b, 0x1f]) expect(interdit(octet), `0x${octet.toString(16)}`).toBe(true);
    // 0x20 est l'espace : la zone s'arrête juste avant.
    expect(interdit(0x20)).toBe(false);
  });

  it("aucun fichier suivi n'en contient", () => {
    const trouvailles = fichiers
      // Un fichier suivi peut manquer du disque le temps d'une suppression en
      // cours de préparation : ce n'est pas le sujet de ce test.
      .filter((fichier) => existsSync(fichier))
      .flatMap((fichier) => controlesDe(fichier));
    // Le message nomme le fichier, la ligne, la colonne et le code : qui le
    // lit corrige sans enquêter.
    expect(trouvailles.map(decrire)).toEqual([]);
  });

  it("le repère donné est juste, y compris après un accent", () => {
    // La colonne se compte en caractères. Vérifié sur un cas fabriqué, parce
    // qu'un repère faux coûterait plus de temps qu'il n'en ferait gagner.
    const dossier = mkdtempSync(join(tmpdir(), "controle-"));
    const fichier = join(dossier, "exemple.txt");
    try {
      // Deux lignes ; le fautif est en 4e position de la seconde, après trois
      // caractères dont deux accentués (donc cinq octets).
      writeFileSync(fichier, `première ligne\nété${String.fromCharCode(8)}fin\n`, "utf8");
      const [trouvaille] = controlesDe(fichier);
      expect(trouvaille).toBeDefined();
      expect(trouvaille.ligne).toBe(2);
      expect(trouvaille.colonne).toBe(4);
      expect(trouvaille.octet).toBe(8);
      expect(decrire(trouvaille)).toContain(":2:4 — caractère de contrôle 0x08");
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
