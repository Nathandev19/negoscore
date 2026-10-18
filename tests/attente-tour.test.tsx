import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThreadPending, THREAD_READING_LABEL } from "@/components/result/negotiation/thread-status";
import { AFTER_READING_STEPS, READING_LABEL, WaitingScreen } from "@/components/loading-steps";
import { auMoins, MIN_ATTENTE_MS, THREAD_PENDING_ID } from "@/lib/ui/reveal";

// Mission #200 — ON VOIT QUE L'OUTIL TRAVAILLE, PENDANT UN TOUR AUSSI.
//
// Un tour affichait une note à filet : juste, mais sans rien qui bouge et sans
// le temps écoulé, là où la première analyse a un panneau encadré, une étape
// qui tourne et un compteur. La différence se lit comme « il ne se passe
// rien ». Le panneau de la première analyse est maintenant employé pour les
// deux.
//
// CE QUI EST VÉRIFIÉ ICI est ce qui casse en silence : l'honnêteté de ce qui
// est annoncé, le plancher d'affichage, et le fait que le bouton refuse un
// second envoi.
//
// CE QUI NE PEUT PAS L'ÊTRE : le projet n'a pas d'environnement DOM (ni jsdom,
// ni @testing-library). On ne clique donc pas sur le bouton. Les garanties qui
// en dépendent sont vérifiées à la source, et le double envoi est vérifié là
// où il compte vraiment — sur le serveur (tests/negotiation-route.test.ts).

const FIL = readFileSync("components/result/negotiation/negotiation-thread.tsx", "utf8");
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("l'honnêteté de ce qui est annoncé", () => {
  const html = renderToStaticMarkup(<ThreadPending turnNumber={3} />);

  it("UNE SEULE ÉTAPE : le serveur ne remonte rien entre le début et la fin", () => {
    // Le serveur appelle le modèle puis fait tout le reste dans la MÊME
    // requête. Le navigateur ne sait qu'une chose : la réponse est arrivée ou
    // non. Quatre étapes qui se cochent seraient jolies et fausses.
    expect(texte(html)).toContain(THREAD_READING_LABEL);
    for (const inventee of AFTER_READING_STEPS) {
      expect(texte(html), inventee).not.toContain(inventee);
    }
    // Une seule puce dans la liste.
    expect(html.split("<li").length - 1).toBe(1);
  });

  it("le libellé dit ce qui se passe vraiment", () => {
    expect(THREAD_READING_LABEL).toBe("Lecture de la réponse de la marque");
    expect(texte(html)).toContain("On lit la réponse de la marque");
  });

  it("LE COMPTEUR SUIT LE TEMPS RÉEL, il n'est pas figé", () => {
    // Un compteur bloqué à « 0 s » passerait pour un écran gelé — et c'est
    // précisément ce qui manquait à l'ancienne note.
    expect(texte(html)).toContain("0 s");
    expect(texte(renderToStaticMarkup(<ThreadPending turnNumber={3} startedAt={Date.now() - 42_000} />))).toContain("42 s");
    expect(texte(renderToStaticMarkup(<ThreadPending turnNumber={3} startedAt={Date.now() - 185_000} />))).toContain("3 min 05 s");
  });

  it("c'est le panneau de la première analyse, pas une copie", () => {
    const source = readFileSync("components/result/negotiation/thread-status.tsx", "utf8");
    expect(source).toContain('from "@/components/loading-steps"');
    expect(source).toContain("<WaitingPanel");
    // Aucune boîte réécrite sur place : la bordure et la mise en page viennent
    // du panneau partagé.
    expect(source).not.toContain("rounded-control border-2");
  });

  it("la première analyse n'a pas bougé : mêmes étapes, même repère pour la barre mobile", () => {
    const premiere = renderToStaticMarkup(<WaitingScreen kind="text" respondedAt={null} />);
    expect(texte(premiere)).toContain("On analyse ton offre");
    expect(texte(premiere)).toContain(READING_LABEL.text);
    for (const etape of AFTER_READING_STEPS) expect(texte(premiere)).toContain(etape);
    expect(premiere).toContain("data-analysis-running");
    // Le panneau d'un tour, lui, ne le porte pas : il s'insère dans la page,
    // il ne remplace pas le formulaire d'analyse.
    expect(html).not.toContain("data-analysis-running");
  });

  it("le panneau s'annonce tout seul, et garde son identifiant d'arrivée", () => {
    expect(html).toContain(`id="${THREAD_PENDING_ID}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('tabindex="-1"');
  });

  it("il dit où le tour apparaîtra, et quel tour", () => {
    expect(texte(html)).toContain("Le tour 3 s'affichera ici");
  });
});

describe("le plancher d'affichage : l'indicateur ne clignote pas", () => {
  it("MIN_ATTENTE_MS vaut 900", () => {
    expect(MIN_ATTENTE_MS).toBe(900);
  });

  it("une réponse immédiate attend quand même le plancher", async () => {
    const depart = Date.now();
    await auMoins(depart);
    expect(Date.now() - depart).toBeGreaterThanOrEqual(MIN_ATTENTE_MS - 20);
  });

  it("une réponse plus lente que le plancher ne retarde rien", async () => {
    const avant = Date.now();
    await auMoins(Date.now() - 1500);
    expect(Date.now() - avant).toBeLessThan(80);
  });

  it("le plancher porte sur le RÉSULTAT, pas sur le panneau seul", () => {
    // Sinon le tour apparaîtrait sous un panneau qui dit encore « lecture en
    // cours » — un mensonge en sens inverse. Le rafraîchissement attend.
    expect(FIL).toContain("await auMoins(departAttente);");
    const apres = FIL.slice(FIL.indexOf("await auMoins(departAttente);"));
    expect(apres.indexOf("router.refresh()")).toBeGreaterThan(0);
    // Et il est posé AVANT la lecture du résultat, pas après.
    expect(FIL.indexOf("await auMoins(departAttente);")).toBeLessThan(FIL.indexOf("if (response.ok) {"));
  });
});

describe("le bouton refuse un second envoi", () => {
  it("il est VRAIMENT désactivé pendant le traitement, pas seulement annoncé comme tel", () => {
    // aria-disabled dit à un lecteur d'écran que le bouton est indisponible,
    // mais le bouton reste cliquable. Un bouton qu'on peut enfoncer pendant
    // que l'outil travaille n'a pas l'air de travailler.
    //
    // Piège de sous-chaîne : « aria-disabled={waiting !== null} » CONTIENT
    // « disabled={waiting !== null} ». La batterie de mutation l'a montré —
    // sans la seconde ligne, remplacer l'un par l'autre ne cassait rien.
    expect(FIL).toContain("disabled={waiting !== null}");
    expect(FIL).not.toContain("aria-disabled={waiting !== null}");
    expect(FIL).toContain('aria-busy={sending === "turn"}');
  });

  it("et le garde JavaScript reste : il couvre l'envoi au clavier", () => {
    const envoi = FIL.slice(FIL.indexOf("async function sendTurn"));
    expect(envoi.slice(0, 200)).toContain("if (waiting) return;");
  });

  it("l'attente est vraie dès l'envoi et jusqu'à l'arrivée du tour", () => {
    expect(FIL).toContain('const waiting: "turn" | "conclusion" | null = sending === "turn" && !arrived');
  });

  it("une clé d'idempotence part avec chaque envoi, et survit au rechargement", () => {
    expect(FIL).toContain("idempotencyKey: keyRef.current");
    expect(FIL).toContain("saveThreadDraft(analysisId, { reply, key: keyRef.current })");
  });
});
