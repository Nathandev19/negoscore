import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { ACQUISITION_UTM, DM_MEDIUM, mediumOf, shortPathAttribution, SHORT_PATHS, shortPathTarget } from "@/lib/acquisition/chemins";
import { proxy } from "@/proxy";

// Mission #212 — UN LIEN DE MESSAGE PRIVÉ NE PEUT PLUS MENTIR SUR SON RÉSEAU.
//
// LE DÉFAUT. /dm forçait `utm_source=instagram`, et le lien était collé en
// message privé sur DEUX réseaux. Toute visite venue d'un DM TikTok comptait
// en Instagram. Ce que ça coûtait n'est pas une décimale : le compteur de
// l'admin est la source autoritaire du projet, parce qu'il a été montré plus
// fiable que celui de TikTok Ads (47 contre 39, puis 353 contre 236). Une
// source falsifiée à l'entrée annule cet acquis — et une mesure fausse ne se
// corrige pas après coup, elle est déjà en base.
//
// CE QUE CE FICHIER TIENT, et que les autres gardes ne tiennent pas :
//   — /dm et /exemple ne bougent PAS, à l'octet près (liens déjà envoyés) ;
//   — chaque réseau a son chemin, et les deux ne se confondent sur AUCUNE
//     colonne du cockpit ;
//   — ce qui doit rester commun le reste : medium `dm`, campagne `lancement` ;
//   — rien d'autre que les quatre UTM ne voyage dans l'adresse ;
//   — et la règle qui empêche le défaut de REVENIR : tout chemin de DM ajouté
//     demain doit nommer son réseau.

const ORIGIN = "https://www.negoscore.fr";
const call = (path: string) => proxy(new NextRequest(new URL(path, ORIGIN)));

const params = (location: string) => new URL(location, ORIGIN).searchParams;

// L'attribution d'un chemin, qu'il redirige ou qu'il soit servi sur place :
// les deux modes doivent répondre la même chose, et c'est ce qui permet de
// comparer /dm-tiktok et /exemple-tiktok dans le même test.
async function attribution(path: string): Promise<Record<string, string>> {
  const servi = shortPathAttribution(path);
  if (servi) {
    const { to: _to, ...utm } = servi;
    void _to;
    return utm;
  }
  const location = (await call(path)).headers.get("location");
  expect(location, path).not.toBeNull();
  return Object.fromEntries(params(location as string).entries());
}

describe("les liens déjà envoyés ne changent pas de comportement", () => {
  // Contrainte non négociable de la mission. Ce n'est pas « à peu près la
  // même chose » : c'est la ligne entière, champ par champ.
  it("/dm reste instagram · lancement · dm_prospection, à l'octet près", async () => {
    expect(SHORT_PATHS.dm).toEqual({ source: "instagram", content: "dm_prospection", medium: DM_MEDIUM });
    expect(await attribution("/dm")).toEqual({
      utm_source: "instagram",
      utm_medium: "dm",
      utm_campaign: "lancement",
      utm_content: "dm_prospection",
    });
  });

  it("/exemple reste instagram · lancement · dm_exemple, servi sur place", async () => {
    expect(SHORT_PATHS.exemple).toEqual({
      source: "instagram", content: "dm_exemple", to: "/analyse/demo", servi: true, medium: DM_MEDIUM,
    });
    expect(await attribution("/exemple")).toEqual({
      utm_source: "instagram",
      utm_medium: "dm",
      utm_campaign: "lancement",
      utm_content: "dm_exemple",
    });
    // Toujours servi, jamais redirigé : la mesure de la #134 tient (~230 ms).
    expect((await call("/exemple")).status).toBe(200);
  });

  it("LES ALIAS SONT EXACTS, pas des lignes voisines", () => {
    // Un alias qui dériverait d'un champ couperait le DM Instagram en deux
    // lignes du cockpit. L'égalité profonde est la seule façon de le dire.
    expect(SHORT_PATHS["dm-instagram"]).toEqual(SHORT_PATHS.dm);
    expect(SHORT_PATHS["exemple-instagram"]).toEqual(SHORT_PATHS.exemple);
  });
});

describe("les deux réseaux ne se confondent sur aucune colonne", () => {
  const paires: Array<[string, string]> = [
    ["/dm-instagram", "/dm-tiktok"],
    ["/exemple-instagram", "/exemple-tiktok"],
  ];

  it.each(paires)("%s et %s : source ET contenu diffèrent", async (insta, tiktok) => {
    const a = await attribution(insta);
    const b = await attribution(tiktok);
    expect(a.utm_source).toBe("instagram");
    expect(b.utm_source).toBe("tiktok");
    // Le cockpit affiche la source en gras et « campagne · contenu » en
    // dessous. Si le contenu était partagé, deux lignes deviendraient
    // indiscernables dès qu'on ne regarde que cette colonne — c'est la raison
    // écrite sous `bio_tiktok` depuis la #145.
    expect(a.utm_content).not.toBe(b.utm_content);
  });

  it.each(paires)("%s et %s : LE MEDIUM ET LA CAMPAGNE RESTENT COMMUNS", async (insta, tiktok) => {
    const a = await attribution(insta);
    const b = await attribution(tiktok);
    // Contrainte non négociable : le réseau est dans la SOURCE, jamais dans le
    // canal ni dans la campagne. C'est aussi ce que dit la littérature
    // d'attribution — `utm_source` nomme la plateforme, `utm_medium` le type
    // de canal — et c'est ce qui garde les deux comparables.
    expect(a.utm_medium).toBe("dm");
    expect(b.utm_medium).toBe("dm");
    expect(a.utm_campaign).toBe(ACQUISITION_UTM.campaign);
    expect(b.utm_campaign).toBe(ACQUISITION_UTM.campaign);
  });

  it("un DM TikTok n'est plus jamais compté en Instagram", async () => {
    for (const path of ["/dm-tiktok", "/exemple-tiktok"]) {
      const utm = await attribution(path);
      expect(utm.utm_source, path).toBe("tiktok");
      expect(utm.utm_source, path).not.toBe("instagram");
    }
  });
});

describe("l'adresse reste collable dans un message", () => {
  it("AUCUNE DONNÉE PERSONNELLE : exactement les quatre UTM, et rien d'autre", async () => {
    for (const path of Object.keys(SHORT_PATHS)) {
      const cible = shortPathTarget(`/${path}`);
      expect(cible, path).not.toBeNull();
      const query = new URL(cible as string, ORIGIN).searchParams;
      expect([...query.keys()].sort(), path).toEqual(["utm_campaign", "utm_content", "utm_medium", "utm_source"]);
    }
  });

  it("chaque chemin est court, en minuscules, sans rien à épeler", () => {
    for (const path of Object.keys(SHORT_PATHS)) {
      // Le plus long aujourd'hui est `exemple-instagram`, 17 caractères :
      // negoscore.fr/exemple-instagram, 30 caractères collés. La borne est
      // là pour qu'un chemin ne devienne pas une phrase.
      expect(path.length, path).toBeLessThanOrEqual(20);
      expect(path, path).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(`negoscore.fr/${path}`.length, path).toBeLessThanOrEqual(40);
    }
  });
});

describe("la règle qui empêche le défaut de revenir", () => {
  // LA GARDE LA PLUS IMPORTANTE DE CE FICHIER.
  //
  // Le défaut n'était pas une faute de frappe : c'était un chemin de DM qui
  // ne nommait aucun réseau, donc un réseau par défaut à oublier. Un chemin
  // de DM ajouté demain sans nommer le sien reproduirait exactement ça.
  //
  // DEUX EXCEPTIONS, et elles sont nommées une par une : les adresses
  // historiques, qu'on ne peut pas renommer sans casser des liens déjà
  // envoyés. Toute autre doit porter son réseau.
  const HISTORIQUES = ["dm", "exemple"];

  it("tout chemin de message privé nomme son réseau, sauf les deux historiques", () => {
    const dms = Object.entries(SHORT_PATHS).filter(([, entry]) => mediumOf(entry) === DM_MEDIUM);
    expect(dms.length).toBeGreaterThanOrEqual(6);
    for (const [cle, entry] of dms) {
      if (HISTORIQUES.includes(cle)) continue;
      expect(cle, cle).toContain(entry.source);
    }
  });

  it("les deux historiques restent les SEULES exceptions", () => {
    const sansReseau = Object.entries(SHORT_PATHS)
      .filter(([cle, entry]) => mediumOf(entry) === DM_MEDIUM && !cle.includes(entry.source))
      .map(([cle]) => cle)
      .sort();
    expect(sansReseau).toEqual(HISTORIQUES);
  });

  it("chaque réseau qui reçoit des DM a son chemin pour les DEUX entrées", () => {
    // /dm demande de coller une offre, /exemple montre l'exemple chiffré :
    // c'est la comparaison ouverte par la #125. La réparer d'un seul côté
    // l'aurait laissée fausse de l'autre.
    for (const reseau of ["instagram", "tiktok"]) {
      for (const racine of ["dm", "exemple"]) {
        const cle = `${racine}-${reseau}`;
        expect(Object.keys(SHORT_PATHS), cle).toContain(cle);
        expect(SHORT_PATHS[cle].source, cle).toBe(reseau);
        expect(mediumOf(SHORT_PATHS[cle]), cle).toBe(DM_MEDIUM);
      }
    }
  });
});
