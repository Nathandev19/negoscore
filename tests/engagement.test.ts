import { describe, expect, it } from "vitest";
import {
  brancherChamp,
  dwellBucket,
  DWELL_BUCKETS,
  firstActionBucket,
  mesure,
  noterChamp,
  noterDefilement,
  noterGeste,
  noterPageBougee,
  noterVisibilite,
  nouvelEtat,
  pourcentageVu,
  scrollBucket,
  signalerChamp,
  SCROLL_BUCKETS,
  type EngagementState,
} from "@/lib/analytics/engagement";

// Mission #209 — LA MESURE EN PAGE, ÉPROUVÉE SANS NAVIGATEUR.
//
// Le calcul est séparé du navigateur exprès : les tranches, le temps visible
// et le premier geste se vérifient ici, à la milliseconde choisie, sans
// dépendre d'un défilement simulé. Ce qui tient au navigateur — les écouteurs,
// l'envoi au départ — est vérifié dans engagement-page.dom.test.tsx.
//
// CE QUI EST SURVEILLÉ ICI est ce qui rendrait le diagnostic FAUX :
//   - une page plus courte que l'écran lue comme « personne ne défile » ;
//   - du temps en onglet caché compté comme du temps de lecture ;
//   - un geste tardif qui écrase l'heure du premier ;
//   - une valeur exacte qui fuirait au lieu d'une tranche.

const T0 = 1_000_000;

describe("les tranches de défilement", () => {
  it("ZÉRO EST UNE TRANCHE À PART : « n'a rien défilé » n'est pas « un peu défilé »", () => {
    // C'est la distinction qui sépare les deux hypothèses. La noyer dans un
    // « 0-25 % » rendrait la mesure inutile pour ce qu'on lui demande.
    expect(scrollBucket(0)).toBe("0");
    expect(scrollBucket(0.4)).toBe("0");
    expect(scrollBucket(1)).toBe("1-25");
    expect(SCROLL_BUCKETS[0].label).toBe("0");
  });

  it("chaque palier tombe du bon côté de sa borne", () => {
    expect(scrollBucket(25)).toBe("1-25");
    expect(scrollBucket(26)).toBe("26-50");
    expect(scrollBucket(50)).toBe("26-50");
    expect(scrollBucket(51)).toBe("51-75");
    expect(scrollBucket(75)).toBe("51-75");
    expect(scrollBucket(76)).toBe("76-89");
    expect(scrollBucket(89)).toBe("76-89");
    // 90 % est la borne publiée de « lue jusqu'au bout » (GA4).
    expect(scrollBucket(90)).toBe("90-100");
    expect(scrollBucket(100)).toBe("90-100");
  });

  it("une valeur hors bornes ne casse rien et ne crée pas de tranche", () => {
    expect(scrollBucket(-10)).toBe("0");
    expect(scrollBucket(999)).toBe("90-100");
    expect(scrollBucket(Number.NaN)).toBe("0");
  });
});

describe("la part de page vue", () => {
  it("UNE PAGE PLUS COURTE QUE L'ÉCRAN VAUT 100 %, pas zéro", () => {
    // Sinon on lirait « personne ne descend » là où il n'y avait rien à
    // descendre — et on corrigerait une page qui n'a pas ce défaut.
    expect(pourcentageVu(0, 800, 600)).toBe(100);
    expect(pourcentageVu(0, 800, 800)).toBe(100);
  });

  it("le bas de l'écran compte comme vu, pas le haut", () => {
    // Arrivée sur une page de 2 000 px avec un écran de 800 : 40 % est déjà
    // sous les yeux sans avoir bougé.
    expect(pourcentageVu(0, 800, 2_000)).toBe(40);
    expect(pourcentageVu(1_200, 800, 2_000)).toBe(100);
    expect(pourcentageVu(600, 800, 2_000)).toBe(70);
  });

  it("une hauteur absente ou absurde vaut zéro, jamais une division par zéro", () => {
    expect(pourcentageVu(0, 800, 0)).toBe(0);
    expect(pourcentageVu(0, 800, Number.NaN)).toBe(0);
    expect(pourcentageVu(0, 800, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("la profondeur gardée est le MAXIMUM atteint, pas la dernière position", () => {
    // Quelqu'un qui descend puis remonte a bien lu le bas.
    const etat = nouvelEtat(T0);
    noterDefilement(etat, 80);
    noterDefilement(etat, 10);
    expect(mesure(etat, T0).scroll).toBe("76-89");
  });
});

describe("le temps visible", () => {
  it("LE TEMPS EN ONGLET CACHÉ N'EST PAS DU TEMPS DE LECTURE", () => {
    // Un onglet ouvert et oublié vingt minutes raconterait une lecture de
    // vingt minutes. C'est le premier mensonge du « temps sur la page ».
    const etat = nouvelEtat(T0);
    noterVisibilite(etat, false, T0 + 3_000);
    noterVisibilite(etat, true, T0 + 900_000);
    expect(mesure(etat, T0 + 901_000).dwell).toBe("1-5s");
  });

  it("le temps court encore quand la page est visible à l'instant de la mesure", () => {
    const etat = nouvelEtat(T0);
    expect(mesure(etat, T0 + 20_000).dwell).toBe("10-30s");
  });

  it("DEUX PASSAGES À « CACHÉ » DE SUITE NE COMPTENT PAS DEUX FOIS", () => {
    // La batterie de mutation a montré que rien d'observable ne dépendait de
    // cette garde : le composant n'envoie qu'une fois, donc un double comptage
    // ne se voyait jamais à l'écran. C'est pourtant un contrat de la fonction
    // exportée, et le démontage appelle noterVisibilite(false) APRÈS un
    // éventuel visibilitychange — exactement ce cas-là.
    const etat = nouvelEtat(T0);
    noterVisibilite(etat, false, T0 + 2_000);
    noterVisibilite(etat, false, T0 + 9_000);
    expect(mesure(etat, T0 + 9_000).dwell).toBe("1-5s");
  });

  it("sous une seconde a sa propre tranche : personne n'a rien lu", () => {
    expect(dwellBucket(0)).toBe("0-1s");
    expect(dwellBucket(999)).toBe("0-1s");
    expect(dwellBucket(1_000)).toBe("1-5s");
    expect(dwellBucket(5_000)).toBe("5-10s");
    expect(dwellBucket(10_000)).toBe("10-30s");
    expect(DWELL_BUCKETS[0].label).toBe("0-1s");
  });

  it("une durée très longue reste dans la dernière tranche", () => {
    expect(dwellBucket(86_400_000)).toBe("30s+");
    expect(dwellBucket(-5)).toBe("0-1s");
  });
});

describe("le premier geste", () => {
  it("« AUCUN » EST UNE VALEUR, et c'est celle qu'on cherche", () => {
    expect(firstActionBucket(null)).toBe("aucun");
    expect(mesure(nouvelEtat(T0), T0 + 30_000).first_action).toBe("aucun");
    expect(mesure(nouvelEtat(T0), T0 + 30_000).scrolled).toBe(false);
  });

  it("SEUL LE PREMIER est daté : un geste tardif n'écrase pas l'heure du premier", () => {
    const etat = nouvelEtat(T0);
    noterGeste(etat, T0 + 400);
    noterGeste(etat, T0 + 50_000);
    expect(mesure(etat, T0 + 60_000).first_action).toBe("0-1s");
  });

  it("chaque palier tombe du bon côté de sa borne", () => {
    expect(firstActionBucket(0)).toBe("0-1s");
    expect(firstActionBucket(999)).toBe("0-1s");
    expect(firstActionBucket(1_000)).toBe("1-5s");
    expect(firstActionBucket(9_999)).toBe("5-10s");
    expect(firstActionBucket(10_000)).toBe("10s+");
  });

  it("UN DÉFILEMENT EST UN GESTE : les deux drapeaux se lèvent ensemble", () => {
    // L'inverse est faux, et c'est voulu : toucher le champ sans défiler est
    // un geste sans défilement. C'est pour ça que « a touché le champ » n'est
    // pas une étape de l'entonnoir du cockpit.
    const etat = nouvelEtat(T0);
    noterPageBougee(etat);
    noterGeste(etat, T0 + 600);
    const relevé = mesure(etat, T0 + 3_000);
    expect(relevé.scrolled).toBe(true);
    expect(relevé.first_action).not.toBe("aucun");

    const sansDefilement = nouvelEtat(T0);
    noterChamp(sansDefilement, "text", T0 + 800);
    expect(mesure(sansDefilement, T0 + 1_000).scrolled).toBe(false);
    expect(mesure(sansDefilement, T0 + 1_000).first_action).not.toBe("aucun");
  });
});

describe("le contact avec le champ", () => {
  it("il compte comme un geste, et garde le PREMIER onglet touché", () => {
    const etat = nouvelEtat(T0);
    noterChamp(etat, "photo", T0 + 2_000);
    noterChamp(etat, "text", T0 + 9_000);
    const relevé = mesure(etat, T0 + 10_000);
    expect(relevé.input).toBe("photo");
    // Garder les deux serait déjà une suite d'actions, donc un parcours.
    expect(relevé.first_action).toBe("1-5s");
  });

  it("sans contact, « aucun » — et jamais une longueur ni un contenu", () => {
    const relevé = mesure(nouvelEtat(T0), T0 + 5_000);
    expect(relevé.input).toBe("aucun");
    // La forme entière de ce qui part : cinq clés, pas une de plus.
    expect(Object.keys(relevé).sort()).toEqual(["dwell", "first_action", "input", "scroll", "scrolled"]);
  });

  it("RIEN QUE DES TRANCHES NE SORT : aucune valeur exacte dans le relevé", () => {
    // Une durée à la milliseconde est une empreinte ; une tranche n'en est
    // pas une. La garde lit le relevé entier, pas des champs choisis.
    const etat: EngagementState = nouvelEtat(T0);
    noterDefilement(etat, 63.7);
    noterChamp(etat, "text", T0 + 4_321);
    const relevé = mesure(etat, T0 + 37_123);
    for (const valeur of Object.values(relevé)) {
      if (typeof valeur === "boolean") continue;
      expect(typeof valeur, JSON.stringify(relevé)).toBe("string");
      expect(valeur, JSON.stringify(relevé)).not.toMatch(/\d{4,}/);
    }
    expect(JSON.stringify(relevé)).not.toContain("4321");
    expect(JSON.stringify(relevé)).not.toContain("63");
  });
});

describe("le pont avec le formulaire", () => {
  it("sans composant de mesure monté, signaler le champ ne fait RIEN", () => {
    // Le formulaire de /analyse appelle la même ligne : elle doit être inerte
    // là où aucune mesure n'est en cours, sans condition chez l'appelant.
    expect(() => signalerChamp("text")).not.toThrow();
  });

  it("le composant monté reçoit, le composant démonté ne reçoit plus", () => {
    const recus: string[] = [];
    const retirer = brancherChamp((onglet) => recus.push(onglet));
    signalerChamp("text");
    retirer();
    signalerChamp("pdf");
    expect(recus).toEqual(["text"]);
  });

  it("un second montage remplace le premier : un seul relevé reçoit", () => {
    // Sinon une navigation côté client attribuerait un contact à la page
    // précédente autant qu'à la nouvelle.
    const premier: string[] = [];
    const second: string[] = [];
    brancherChamp((onglet) => premier.push(onglet));
    const retirerSecond = brancherChamp((onglet) => second.push(onglet));
    signalerChamp("text");
    retirerSecond();
    expect(premier).toEqual([]);
    expect(second).toEqual(["text"]);
  });
});
