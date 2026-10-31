import { describe, expect, it } from "vitest";
import {
  extractionSansFuites,
  fuiteDe,
  fuitesDeLExtraction,
  fuitesDuTour,
  journalDeFuite,
  lettresNonLatines,
  scriptsAutorises,
  scriptsDe,
  scriptsNonLatins,
  tourSansFuites,
} from "@/lib/llm/langue";

// Mission #210 — LE CAS DE PRODUCTION, ET CE QU'IL NE FAUT PAS CASSER.
//
// Constaté le 31/10/2026, sur une analyse réelle, dans les risques affichés :
//
//   « Les contenus sont demandés en échange de produits בלבד, avec une
//     éventuelle rémunération seulement pour une future collaboration. »
//
// L'offre était une proposition de gifting en français, sans un seul caractère
// non latin. Le premier test de ce fichier est ce cas-là, tel quel.
//
// La moitié des tests porte sur ce qu'il ne faut PAS casser : un nom de marque
// japonais, une offre en hébreu, une offre en russe, la ponctuation française,
// les emoji. Une garde qui refuse des cas légitimes finit désactivée, et le
// défaut revient par la porte de derrière.

// Le texte exact rendu à l'écran le 31/10.
const PHRASE_DU_BUG =
  "Les contenus sont demandés en échange de produits בלבד, avec une éventuelle rémunération seulement pour une future collaboration.";

// L'offre analysée ce jour-là : du gifting, en français, sans un caractère
// non latin. C'est elle qui sert de référence de langue.
const OFFRE_FRANCAISE =
  "Bonjour ! On adore ton contenu. On te propose de recevoir notre routine complète (valeur 120 €) en échange de 2 publications Instagram. Pas de budget pour cette campagne, mais on pense à toi pour une collaboration rémunérée plus tard.";

describe("LE CAS DU 31/10 : un mot hébreu dans une phrase française", () => {
  const autorises = scriptsAutorises(OFFRE_FRANCAISE);

  it("l'offre de référence ne contient AUCUN script non latin", () => {
    // Si ce n'était pas vrai, la fuite serait tolérée, et le test ne prouverait
    // rien. C'est le fait qui rend tout le reste concluant.
    expect(scriptsNonLatins(OFFRE_FRANCAISE)).toEqual([]);
    expect(autorises.size).toBe(0);
  });

  it("LA PHRASE EST REFUSÉE, et le mot fautif est nommé", () => {
    const fuite = fuiteDe("red_flags[0].why", PHRASE_DU_BUG, autorises);
    expect(fuite).not.toBeNull();
    expect(fuite!.champ).toBe("red_flags[0].why");
    expect(fuite!.scripts).toEqual(["Hebrew"]);
    // Les quatre lettres de בלבד, dédoublonnées : ל apparaît une fois.
    expect(fuite!.lettres.join("")).toBe("בלבד".split("").filter((c, i, t) => t.indexOf(c) === i).join(""));
  });

  it("le reste de la phrase, lui, ne gêne pas : accents, virgule, « é »", () => {
    const sansHebreu = PHRASE_DU_BUG.replace("בלבד", "seulement");
    expect(fuiteDe("red_flags[0].why", sansHebreu, autorises)).toBeNull();
  });

  it("DANS UNE EXTRACTION ENTIÈRE, le risque fautif est retiré et le reste survit", () => {
    const extraction = {
      red_flags: [
        { label: "Aucune rémunération", why: PHRASE_DU_BUG },
        { label: "Droits non bornés", why: "La durée d'utilisation des contenus n'est pas précisée." },
      ],
      good_points: [{ label: "Produit offert", why: "La valeur du produit est indiquée." }],
      negotiate: [{ label: "Demander un fixe", why: "Une publication a une valeur, même avec un produit offert." }],
      counter_offer: { changes: ["Obtenir une rémunération fixe"] },
      input_quality: { missing_critical: [] },
    };
    const { extraction: propre, fuites } = extractionSansFuites(extraction, autorises);
    expect(fuites.map((fuite) => fuite.champ)).toEqual(["red_flags[0].why"]);
    // Le risque fautif part ENTIER : une phrase amputée de son mot hébreu
    // donnerait « en échange de produits , avec une éventuelle… », ce qui est
    // pire à l'écran que le mot lui-même.
    expect(propre.red_flags).toHaveLength(1);
    expect(propre.red_flags[0].label).toBe("Droits non bornés");
    // Et RIEN D'AUTRE ne bouge : l'analyse n'est pas vide, la page n'est pas
    // cassée. C'est l'exigence de la mission.
    expect(propre.good_points).toHaveLength(1);
    expect(propre.negotiate).toHaveLength(1);
    expect(propre.counter_offer.changes).toHaveLength(1);
  });

  it("le journal dit où, quel script et quelles lettres — jamais la phrase", () => {
    // La phrase décrit l'offre d'une créatrice. Un journal n'est pas un
    // endroit pour ça : la mesure première partie ne contient aucune donnée
    // de deal, et un journal d'erreur n'a pas à faire exception.
    const journal = journalDeFuite(fuitesDeLExtraction({ red_flags: [{ label: "x", why: PHRASE_DU_BUG }] }, autorises));
    const brut = JSON.stringify(journal);
    expect(brut).toContain("Hebrew");
    expect(brut).toContain("red_flags[0].why");
    expect(brut).not.toContain("produits");
    expect(brut).not.toContain("rémunération");
  });
});

describe("ce qu'il ne faut PAS casser", () => {
  it("UN NOM DE MARQUE JAPONAIS, quand l'offre est japonaise", () => {
    const offre = "株式会社ABCです。インスタグラムで2本の投稿をお願いします。";
    const autorises = scriptsAutorises(offre);
    // Le modèle écrit en français et nomme la marque : rien à signaler.
    expect(fuiteDe("red_flags[0].why", "La marque 株式会社ABC ne précise aucune durée.", autorises)).toBeNull();
  });

  it("UNE OFFRE EN HÉBREU : l'hébreu a le droit de ressortir", () => {
    const offre = "שלום, אנחנו מציעים לך שיתוף פעולה בתשלום של 300 ש״ח.";
    const autorises = scriptsAutorises(offre);
    expect(fuiteDe("red_flags[0].why", PHRASE_DU_BUG, autorises)).toBeNull();
  });

  it("UNE OFFRE EN RUSSE : le cyrillique passe, mais pas l'hébreu", () => {
    const offre = "Здравствуйте! Предлагаем сотрудничество за 300 евро.";
    const autorises = scriptsAutorises(offre);
    expect(fuiteDe("x", "La marque Крафт propose 300 €.", autorises)).toBeNull();
    // Un script qui n'est pas dans l'offre reste une fuite : la règle est
    // relative à l'entrée, pas une permission générale.
    expect(fuiteDe("x", PHRASE_DU_BUG, autorises)).not.toBeNull();
  });

  it("la ponctuation française, les chiffres et les emoji ne sont JAMAIS des fuites", () => {
    const autorises = scriptsAutorises("offre en français");
    for (const texte of [
      "Rémunération différée, à préciser — 1 500 € HT.",
      "« Exclusivité » de 6 mois : trop long.",
      "Le délai de paiement est de 60 jours… c'est beaucoup.",
      "Attention 🎉 à la cession de droits !",
      "Montant : 1 200,50 € (TTC) ; soit ~1 000 € HT.",
      "Æsop, Œuvre, Ångström, Çağla, Łódź, Ñandú",
    ]) {
      expect(fuiteDe("x", texte, autorises), texte).toBeNull();
    }
  });

  it("UNE EXTRACTION SANS FUITE est rendue TELLE QUELLE, sans recopie", () => {
    // Le chemin normal ne doit rien reconstruire : c'est le cas de presque
    // toutes les analyses, et une recopie inutile est une occasion de bug.
    const extraction = { red_flags: [{ label: "a", why: "b" }], good_points: [], negotiate: [] };
    const resultat = extractionSansFuites(extraction, scriptsAutorises("offre"));
    expect(resultat.extraction).toBe(extraction);
    expect(resultat.fuites).toEqual([]);
  });
});

describe("une offre déposée en photo ou en PDF", () => {
  it("SANS TEXTE DE RÉFÉRENCE, la prose est tenue au latin", () => {
    // Une photo n'a jamais traversé notre code sous forme de texte : il n'y a
    // pas de référence. On est alors plus strict, et c'est le bon sens — un
    // nom de marque japonais a sa place dans `brand`, qui n'est pas contrôlé,
    // pas dans une phrase française sur les risques.
    const autorises = scriptsAutorises(null);
    expect(autorises.size).toBe(0);
    expect(fuiteDe("red_flags[0].why", PHRASE_DU_BUG, autorises)).not.toBeNull();
    expect(fuiteDe("red_flags[0].why", "Aucune rémunération prévue.", autorises)).toBeNull();
  });
});

describe("les écritures, nommées par ensembles", () => {
  it("UNE LETTRE PEUT APPARTENIR À PLUSIEURS ÉCRITURES, et une seule suffit", () => {
    // Le cas réel, trouvé en mesurant plutôt qu'en supposant : « ー »
    // (U+30FC), la marque d'allongement japonaise, appartient À LA FOIS à
    // Hiragana et à Katakana. On la croise dans n'importe quel nom de produit
    // japonais — コーヒー, ソニー.
    //
    // Deux premières écritures de ce fichier échouaient ici, et la batterie de
    // mutation l'a montré : rendre une seule écriture par lettre, ou exiger
    // que TOUTES soient autorisées, refuse « ー » sur une offre en katakana.
    expect(scriptsDe("ー")).toEqual(["Hiragana", "Katakana"]);

    // Une offre en katakana, SANS marque d'allongement : l'écriture autorisée
    // est Katakana, et elle seule.
    const autorises = scriptsAutorises("カタカナ ブランド インスタグラム");
    expect([...autorises]).toEqual(["Katakana"]);

    // Le nom du produit, lui, en porte une. Il doit passer : Katakana est dans
    // ses écritures, et il suffit que l'UNE le soit.
    expect(fuiteDe("red_flags[0].why", "La marque コーヒー ne précise rien.", autorises)).toBeNull();

    // Et l'hébreu, lui, ne passe toujours pas : la règle reste relative à
    // l'entrée, elle ne s'est pas ramollie.
    expect(fuiteDe("red_flags[0].why", PHRASE_DU_BUG, autorises)).not.toBeNull();
  });

  it("UTS #24 §5.3 SAUVE UNE APOSTROPHE FRANÇAISE, et ce n'est pas théorique", () => {
    // « ʼ » (U+02BC, MODIFIER LETTER APOSTROPHE) est une LETTRE dont la
    // propriété `Script` vaut Common, mais dont `Script_Extensions` inclut
    // Latin. Certains claviers et certains CMS la produisent à la place de
    // l'apostrophe courbe : « lʼoffre » au lieu de « l’offre ».
    //
    // En appariant sur `Script` — ce que la doc Unicode déconseille
    // explicitement — cette apostrophe ne serait pas latine, et une phrase
    // française parfaitement ordinaire serait refusée comme une fuite. La
    // batterie de mutation a montré qu'aucun test ne voyait la différence.
    const apostrophe = "ʼ";
    expect(/\p{Script_Extensions=Latin}/u.test(apostrophe)).toBe(true);
    expect(/\p{Script=Latin}/u.test(apostrophe)).toBe(false);

    const autorises = scriptsAutorises("offre en français");
    expect(lettresNonLatines(`l${apostrophe}offre`)).toEqual([]);
    expect(fuiteDe("red_flags[0].why", `L${apostrophe}exclusivité n${apostrophe}est pas bornée.`, autorises)).toBeNull();
  });

  it("une écriture inconnue de la liste se nomme « autre » et reste refusée", () => {
    // La liste ne sert qu'au journal : la détection, elle, refuse tout ce qui
    // n'est pas latin. Une écriture absente de la liste ne passe pas pour
    // autant.
    const autorises = scriptsAutorises("offre en français");
    const rune = "ᚠ"; // ᚠ, vieux-norrois — hors de la liste nommée
    expect(lettresNonLatines(rune)).toEqual([rune]);
    expect(scriptsDe(rune)).toEqual(["autre"]);
    expect(fuiteDe("x", `Clause ${rune} étrange`, autorises)).not.toBeNull();
  });

  it("les scripts d'un texte sont triés et dédoublonnés", () => {
    expect(scriptsNonLatins("בלבד فقط")).toEqual(["Arabic", "Hebrew"]);
    expect(scriptsNonLatins("du français seulement")).toEqual([]);
  });
});

describe("un tour de négociation, mêmes deux familles", () => {
  const REPONSE = "Merci pour ton message ! On peut monter à 450 € mais on garde l'exclusivité 6 mois.";
  const autorises = scriptsAutorises(REPONSE);

  it("UN DOUTE QUI FUIT est retiré, et les autres restent", () => {
    const lecture = {
      relevance_note: "",
      uncertainties: ["La marque ne dit pas si בלבד les droits pub sont inclus.", "Le délai de paiement reste flou."],
      asks: [{ remaining: null }, { remaining: "les supports de diffusion" }],
    };
    const { lecture: propre, fuites } = tourSansFuites(lecture, autorises);
    expect(fuites.map((fuite) => fuite.champ)).toEqual(["uncertainties[0]"]);
    expect(propre.uncertainties).toEqual(["Le délai de paiement reste flou."]);
    expect(propre.asks).toEqual(lecture.asks);
  });

  it("CE QUI RESTE À PRÉCISER retombe à null plutôt que de disparaître de la demande", () => {
    // La demande elle-même doit survivre : son statut « accordé en partie » est
    // une information, et c'est la précision manquante qu'on perd, pas le fait.
    const lecture = { uncertainties: [], asks: [{ remaining: "בלבד les supports" }] };
    const { lecture: propre, fuites } = tourSansFuites(lecture, autorises);
    expect(fuites.map((fuite) => fuite.champ)).toEqual(["asks[0].remaining"]);
    expect(propre.asks).toEqual([{ remaining: null }]);
  });

  it("une note de pertinence qui fuit est vidée, jamais rafistolée", () => {
    const { lecture: propre } = tourSansFuites({ relevance_note: "Ce texte בלבד ne répond pas." }, autorises);
    expect(propre.relevance_note).toBe("");
  });

  it("LES CITATIONS NE SONT PAS CONTRÔLÉES : elles recopient la marque", () => {
    // Une citation est mot pour mot par construction, et une réponse de marque
    // peut être dans n'importe quelle langue. La contrôler reviendrait à
    // refuser la réponse de la marque elle-même.
    const lecture = {
      uncertainties: [],
      asks: [{ remaining: null }],
    };
    expect(fuitesDuTour(lecture, scriptsAutorises(null))).toEqual([]);
  });

  it("une réponse de marque en arabe autorise l'arabe dans les doutes", () => {
    const arabe = scriptsAutorises("مرحبا، نقترح عليك 300 يورو مقابل منشورين.");
    expect(fuitesDuTour({ uncertainties: ["La marque écrit فقط sans préciser."] }, arabe)).toEqual([]);
  });
});

describe("la classification des champs reste COMPLÈTE", () => {
  // Le jour où quelqu'un ajoute un champ de prose au schéma, il doit choisir :
  // contrôlé, ou exempté avec sa raison. Sans cette garde, un champ nouveau
  // serait muet — ni l'un ni l'autre — et la fuite reviendrait par là.

  // Les champs contrôlés, tels que lib/llm/langue.ts les parcourt.
  const CONTROLES = [
    "good_points[].label", "good_points[].why",
    "red_flags[].label", "red_flags[].why",
    "negotiate[].label", "negotiate[].why",
    "counter_offer.changes[]",
    "input_quality.missing_critical[]",
  ];

  // Les champs exemptés, chacun avec sa raison. Ce ne sont pas des oublis.
  const EXEMPTES: Record<string, string> = {
    "deal.brand": "nom de la marque, recopié de l'offre",
    "deal.deliverables[].format": "format tel qu'écrit dans l'offre",
    "deal.usage.territory": "territoire tel qu'écrit dans l'offre",
    "deal.usage.territory_zones[]": "vocabulaire fermé de la table de tarifs",
    "deal.exclusivity.category": "catégorie telle qu'écrite dans l'offre",
    "deal.payment.currency": "code de devise lu dans l'offre, par exemple EUR ou CHF",
    "deal.payment.schedule": "modalités telles qu'écrites dans l'offre",
    "deal.variable_pay.base": "assiette telle qu'écrite dans l'offre",
    "deal.variable_pay.payout": "modalités telles qu'écrites dans l'offre",
    "deal.deadlines[]": "échéances telles qu'écrites dans l'offre",
    "deal.kill_fee": "clause telle qu'écrite dans l'offre",
    "deal.termination": "clause telle qu'écrite dans l'offre",
    "deal.governing_law": "droit applicable tel qu'écrit dans l'offre",
    "ready_to_send_message.text": "le prompt le veut dans la langue de l'offre",
    "ready_to_send_message.tone": "jamais affiché tel quel : lib/tone.ts le ramène à trois étiquettes françaises",
  };

  it("TOUS LES CHAMPS TEXTE DU SCHÉMA sont soit contrôlés, soit exemptés avec une raison", async () => {
    const { extractionJsonSchema } = await import("@/lib/llm/prompt");
    const estString = (t: unknown) => t === "string" || (Array.isArray(t) && t.includes("string"));
    const chemins: string[] = [];
    const marche = (noeud: unknown, chemin: string): void => {
      if (!noeud || typeof noeud !== "object") return;
      const n = noeud as Record<string, unknown>;
      if (estString(n.type) && !n.enum) chemins.push(chemin);
      if (n.properties) {
        for (const [cle, valeur] of Object.entries(n.properties as Record<string, unknown>)) {
          marche(valeur, chemin ? `${chemin}.${cle}` : cle);
        }
      }
      if (n.items) marche(n.items, `${chemin}[]`);
      if (Array.isArray(n.anyOf)) for (const branche of n.anyOf) marche(branche, chemin);
    };
    marche(extractionJsonSchema(), "");

    const connus = new Set([...CONTROLES, ...Object.keys(EXEMPTES)]);
    const inconnus = [...new Set(chemins)].filter((chemin) => !connus.has(chemin));
    expect(
      inconnus,
      `Champ(s) texte non classés : ${inconnus.join(", ")}.\n` +
        "Ajoute-les soit au parcours de lib/llm/langue.ts (prose française, contrôlée),\n" +
        "soit à la liste EXEMPTES de ce test, avec la raison de l'exemption.",
    ).toEqual([]);
    // Et la garde ne passe pas parce qu'elle n'aurait rien trouvé.
    expect(chemins.length).toBeGreaterThan(15);
  });

  it("chaque exemption porte une raison écrite, pas une case cochée", () => {
    for (const [champ, raison] of Object.entries(EXEMPTES)) {
      expect(raison.length, champ).toBeGreaterThan(15);
    }
  });

  it("les champs contrôlés sont bien ceux que le parcours visite", () => {
    // Si le parcours en oubliait un, la liste ci-dessus mentirait.
    const fuites = fuitesDeLExtraction(
      {
        good_points: [{ label: "בלבד", why: "בלבד" }],
        red_flags: [{ label: "בלבד", why: "בלבד" }],
        negotiate: [{ label: "בלבד", why: "בלבד" }],
        counter_offer: { changes: ["בלבד"] },
        input_quality: { missing_critical: ["בלבד"] },
      },
      scriptsAutorises("offre en français"),
    );
    expect(fuites.map((fuite) => fuite.champ).sort()).toEqual(
      CONTROLES.map((champ) => champ.replace("[]", "[0]")).sort(),
    );
  });
});
