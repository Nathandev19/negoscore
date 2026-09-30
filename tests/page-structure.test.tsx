import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { EstimateFeedback } from "@/components/result/estimate-feedback";
import { ConclusionView } from "@/components/result/negotiation/conclusion-view";
import { shouldAskFeedback } from "@/lib/analysis/feedback";
import { judgedRanges } from "@/lib/analysis/judged-ranges";
import { previewAnalysis } from "@/lib/fixtures/preview-states";
import { formatEurRange } from "@/lib/money";
import { DEFAULT_TIER } from "@/lib/rates/tier";

// Mission #097 — on ne supprime rien, on replie, on condense, on réordonne.
// Les hauteurs se mesurent dans un navigateur ; ce qui se teste ici, c'est la
// STRUCTURE rendue par le serveur : l'ordre, l'unicité des commandes, et le
// fait que les replis sont natifs — donc qu'ils marchent sans JavaScript.

const { analysis } = previewAnalysis("debloque");
const locked = previewAnalysis("verrouille");

const html = (node: React.ReactNode) => renderToStaticMarkup(node);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[\s  ]+/g, " ");

const page = (extra?: { children?: React.ReactNode; afterMessage?: React.ReactNode }) =>
  html(
    <AnalysisResult analysis={analysis} unlockHref="/connexion" afterMessage={extra?.afterMessage}>
      {extra?.children}
    </AnalysisResult>,
  );

// Position du premier titre de section portant ce libellé.
// Les apostrophes sont échappées dans le rendu : on cherche le titre tel que
// le HTML l'écrit.
const escaped = (value: string) => value.replace(/'/g, "&#x27;");
// Espaces insécables ramenées à l'espace simple, comme dans text().
const plain = (value: string) => value.replace(/[\s\u00a0\u202f]+/g, " ");

const at = (markup: string, title: string) => {
  const index = markup.indexOf(`>${escaped(title)}<`);
  if (index < 0) throw new Error(`section introuvable : ${title}`);
  return index;
};

// Ce texte est-il DANS un <details> ? (et, si oui, ouvert ou fermé)
function inDetails(markup: string, needle: string): { inside: boolean; open: boolean } {
  const index = markup.indexOf(needle);
  expect(index, needle).toBeGreaterThan(-1);
  const before = markup.slice(0, index);
  const start = before.lastIndexOf("<details");
  // Un <details> refermé avant le texte ne le contient pas.
  if (start < 0 || before.slice(start).includes("</details>")) return { inside: false, open: false };
  const tag = markup.slice(start, markup.indexOf(">", start));
  return { inside: true, open: /\bopen\b/.test(tag) };
}

// Le <details> qui contient ce texte, avec son attribut open.
function detailsAround(markup: string, needle: string): { open: boolean } {
  const found = inDetails(markup, needle);
  expect(found.inside, `aucun <details> autour de « ${needle} »`).toBe(true);
  return { open: found.open };
}

describe("étape 3 — l'ordre de la page", () => {
  // Mission #126 — L'ORDRE S'INVERSE, ET C'EST UN CHOIX.
  //
  // La mission #097 avait placé la contre-offre et le message AVANT les
  // conseils : « ce sur quoi elle doit agir vient avant ce qui le commente ».
  // Pour qui n'a pas encore donné son email, ces deux blocs sont VERROUILLÉS —
  // ils apparaissaient donc au milieu de la page et laissaient croire que tout
  // ce qui suit l'était aussi. Or tout ce qui suit est gratuit : les cinq
  // points à négocier avec leurs montants, les signaux, les repères
  // juridiques. L'ordre devient : tout ce qu'on donne, puis la seule chose qui
  // demande un email.
  it("1. tout ce qui est gratuit vient avant ce qui demande un email", () => {
    const markup = page();
    const order = [
      "Ce que ça vaut",
      "Ce qu'il faut négocier",
      "Le deal proposé",
      "Red flags",
      "Ce qui est bon",
      "Bon à savoir côté loi française",
      "Ta contre-offre chiffrée",
      "Ton message prêt à envoyer",
    ];
    const positions = order.map((title) => at(markup, title));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Le verdict, lui, ouvre la page.
    expect(at(markup, "Résultat de l'analyse de ton deal")).toBeLessThan(positions[0]);
  });

  it("1 bis. les deux blocs verrouillés arrivent APRÈS les repères juridiques", () => {
    const markup = page();
    for (const gratuit of ["Ce qu'il faut négocier", "Red flags", "Bon à savoir côté loi française"]) {
      expect(at(markup, gratuit), gratuit).toBeLessThan(at(markup, "Ta contre-offre chiffrée"));
      expect(at(markup, gratuit), gratuit).toBeLessThan(at(markup, "Ton message prêt à envoyer"));
    }
  });

  it("1 ter. la suite de l'échange reste collée au message", () => {
    const markup = page({ afterMessage: <section id="echange">La suite de l&apos;échange</section> });
    // Ce qu'on fait APRÈS avoir envoyé le message n'a de sens qu'à côté de lui.
    expect(markup.indexOf('id="echange"')).toBeGreaterThan(at(markup, "Ton message prêt à envoyer"));
    // Et elle descend avec lui, sous les conseils.
    expect(markup.indexOf('id="echange"')).toBeGreaterThan(at(markup, "Ce qu'il faut négocier"));
  });
});

describe("étape 2 — une seule commande de niveau", () => {
  it("2. le bloc de choix du niveau n'est rendu qu'une fois", () => {
    const markup = page();
    expect(markup.split('id="niveau"').length - 1).toBe(1);
    // Les trois niveaux, avec leur description, sont toujours là.
    expect(markup.split('name="niveau"').length - 1).toBe(3);
    expect(text(markup)).toContain("Premières collabs, souvent payées en produits ou peu payées.");
    // La ligne du bandeau reste, et pointe vers l'unique bloc.
    expect(text(markup)).toContain("Calculé pour le niveau");
    expect(markup).toContain('href="#niveau"');
  });

  it("2 bis. ce bloc est replié par défaut, et son repli est natif", () => {
    const markup = page();
    expect(detailsAround(markup, 'id="niveau"').open).toBe(false);
  });
});

describe("étape 4 — ce qui se replie", () => {
  it("3. le deal proposé, la loi française et les red flags non graves sont repliés", () => {
    const markup = page();
    expect(detailsAround(markup, "Le deal proposé").open).toBe(false);
    expect(detailsAround(markup, "Bon à savoir côté loi française").open).toBe(false);
    // « À surveiller » et « Mineur » : titre et gravité visibles, explication repliée.
    for (const flag of ["Paiement à 60 jours", "Territoire des pubs non précisé"]) {
      expect(detailsAround(markup, flag).open).toBe(false);
    }
    // Rien n'est perdu : les explications sont dans le document.
    expect(text(markup)).toContain("Tu avances ton temps et ton matériel");
  });

  it("4. un red flag « Grave » est rendu déplié", () => {
    const markup = page();
    // Ni le titre ni l'explication ne sont dans un repli : ça se lit sans geste.
    expect(inDetails(markup, "Révisions illimitées").inside).toBe(false);
    expect(inDetails(markup, "Sans limite, la marque peut te demander").inside).toBe(false);
    // Les non graves, eux, le sont.
    expect(inDetails(markup, "Tu avances ton temps et ton matériel").inside).toBe(true);
  });

  it("4 bis. « Ce qui est bon » est condensé, une ligne par point, texte au clic", () => {
    const markup = page();
    expect(detailsAround(markup, "Une offre chiffrée dès le départ").open).toBe(false);
    expect(text(markup)).toContain("Tu pars d'un montant clair");
  });

  it("10. les replis sont natifs : aucun état React, ils marchent sans JavaScript", () => {
    const markup = page();
    // Chaque repli est un <details> avec son <summary> : rendu par le serveur,
    // ouvrable sans une ligne de JavaScript.
    const details = markup.split("<details").length - 1;
    expect(details).toBeGreaterThanOrEqual(6);
    expect(markup.split("<summary").length - 1).toBe(details);
    expect(markup).not.toContain('aria-expanded="false"');
  });
});

describe("étape 5 — les renvois mensongers", () => {
  it("5. aucun renvoi vers un ailleurs qui est en fait juste à côté", () => {
    const markup = text(html(<AnalysisResult analysis={locked.analysis} unlockHref="/connexion" />));
    expect(markup).not.toContain("plus bas sur cette page");
    expect(markup).not.toContain("affichée plus haut");
    // Ce qui reste dit où est vraiment le bouton.
    expect(markup).toContain("Ton email suffit pour le débloquer, avec le bouton juste en dessous.");
  });
});

describe("étape 6 — la question de l'avis", () => {
  const ranges = judgedRanges(analysis);
  const range = formatEurRange(analysis.estimate.total_low, analysis.estimate.total_high);

  it("6. la question reprend les deux bornes de la fourchette jugée", () => {
    const markup = text(html(<EstimateFeedback action={null} initial={null} ranges={ranges} />));
    expect(range).not.toBeNull();
    expect(plain(markup)).toContain(plain(`${ranges[DEFAULT_TIER]} te paraît juste ?`));
    expect(markup).not.toContain("affichée plus haut");
  });

  it("7. fourchette inchangée depuis la dernière réponse : la question n'est pas reposée", () => {
    expect(
      shouldAskFeedback({ current: { low: 1000, high: 2400 }, lastJudged: { low: 1000, high: 2400 }, answeredThisTurn: false }),
    ).toBe(false);
  });

  it("8. fourchette changée : la question est reposée", () => {
    expect(
      shouldAskFeedback({ current: { low: 1200, high: 2400 }, lastJudged: { low: 1000, high: 2400 }, answeredThisTurn: false }),
    ).toBe(true);
    // Jamais répondu : on demande.
    expect(shouldAskFeedback({ current: { low: 1000, high: 2400 }, lastJudged: null, answeredThisTurn: false })).toBe(true);
    // Déjà répondu sur CE tour : la réponse reste modifiable, ce n'est pas une
    // nouvelle demande.
    expect(
      shouldAskFeedback({ current: { low: 1000, high: 2400 }, lastJudged: { low: 1000, high: 2400 }, answeredThisTurn: true }),
    ).toBe(true);
  });

  it("9. sur la conclusion, l'avis vient après les deux messages", () => {
    const conclusion = {
      source: "creator_accepted" as const,
      recap: [],
      unclear: [],
      message: "Bonjour, je confirme.",
      legal_note: "",
      // Mission #104, D : la conclusion porte le montant qu'elle propose.
      offered: null,
    };
    const markup = page({
      afterMessage: <ConclusionView conclusion={conclusion} />,
      children: <EstimateFeedback action={null} initial={null} ranges={ranges} />,
    });
    const messages = markup.indexOf("Bonjour, je confirme.");
    const avis = markup.indexOf("te paraît juste ?");
    expect(messages).toBeGreaterThan(-1);
    expect(avis).toBeGreaterThan(messages);
  });
});
