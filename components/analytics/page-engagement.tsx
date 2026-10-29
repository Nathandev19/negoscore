"use client";

import { useEffect } from "react";
import { currentAttribution } from "@/components/analytics/first-party-view";
import {
  brancherChamp,
  mesure,
  noterChamp,
  noterDefilement,
  noterGeste,
  noterPageBougee,
  noterVisibilite,
  nouvelEtat,
  pourcentageVu,
  type EngagementState,
} from "@/lib/analytics/engagement";

// Mission #209 — LE RELEVÉ, CÔTÉ NAVIGATEUR. Aucun pixel à l'écran.
//
// Ce composant rend `null`. Il n'ajoute aucun élément au balisage, ne change
// aucun style, ne touche à aucun texte : la contrainte de la mission est que
// rien ne bouge à l'écran, et la seule façon de la tenir est de ne rien
// rendre. C'est aussi pourquoi la profondeur n'est PAS mesurée par
// IntersectionObserver, qui aurait demandé de poser des repères invisibles
// dans la page — du balisage en plus, donc un risque de mise en page en plus,
// pour une mesure qui ne rend de toute façon que des paliers (MDN :
// « One thing the Intersection Observer API can't do: trigger logic based on
// the exact number of pixels that overlap »).
//
// ─── CE QUE ÇA COÛTE AU CHARGEMENT : RIEN ──────────────────────────────────
//
// 1. Tout est dans un effet : il ne s'exécute qu'APRÈS le premier affichage.
//    Rien de ce fichier n'est sur le chemin du rendu.
// 2. AUCUN ENVOI PENDANT LA LECTURE. Un seul événement part, au départ de la
//    page. Pas de battement périodique, pas d'événement par palier de
//    défilement : il n'y a donc aucune requête en concurrence avec la page.
// 3. Le défilement ne lit la mise en page QU'UNE FOIS PAR IMAGE. L'écouteur
//    de `scroll` ne fait que lever un drapeau ; la lecture de
//    `scrollHeight` — la seule qui puisse forcer un calcul de mise en page —
//    se fait dans un requestAnimationFrame, au moment où le navigateur
//    s'apprêtait de toute façon à recalculer. C'est le remède que MDN décrit
//    quand il explique pourquoi l'IntersectionObserver existe : le défaut
//    classique est « event handlers and loops calling methods like
//    Element.getBoundingClientRect() […] all this code runs on the main
//    thread ». On n'appelle jamais getBoundingClientRect.
//    À noter, et c'est contre-intuitif : `passive: true` n'apporte rien ici.
//    La documentation Chrome le dit — l'événement `scroll` « cannot be
//    canceled, so it does not need to be set passive » ; le drapeau sert à
//    `touchstart`/`wheel`. Il est quand même passé pour les écouteurs tactiles.
//
// ─── QUAND L'ÉVÉNEMENT PART : DEUX SOURCES OFFICIELLES SE CONTREDISENT ─────
//
// MDN range `pagehide` parmi les événements « legacy » et conclut
// « Developers should use visibilitychange instead », parce que sur mobile
// « the browser will not fire these events » dans des cas courants (bascule
// vers une autre application puis fermeture depuis le gestionnaire).
// web.dev, de son côté, dit « Never add an unload event listener! Use the
// pagehide event instead » et ne mentionne jamais visibilitychange.
//
// Les deux sont des sources officielles, et aucune des deux ne couvre ce que
// l'autre couvre. On écoute donc LES DEUX, et l'envoi est idempotent : le
// premier qui se déclenche envoie, le second ne fait rien. `unload` n'est
// écouté nulle part — là, les deux sources sont d'accord, et un écouteur
// `unload` rendrait en plus la page inéligible au cache de navigation arrière.
//
// RETOUR PAR LE CACHE DE NAVIGATION ARRIÈRE : web.dev signale que « many
// analytics libraries don't measure bfcache restores as new pageviews ». Une
// page restaurée a déjà envoyé son relevé ; sans traitement, une seconde
// lecture serait invisible. `pageshow` avec `persisted` repart donc d'un
// relevé neuf.

export function PageEngagement() {
  useEffect(() => {
    // Même refus que FirstPartyView, et le serveur revérifie DNT et Sec-GPC
    // de son côté (lib/analytics/robots.ts) : la promesse de la page de
    // confidentialité tient aussi pour qui n'a pas JavaScript.
    if (navigator.doNotTrack === "1") return;

    let etat: EngagementState = nouvelEtat(Date.now());
    let frameDemandee = false;

    const envoyer = () => {
      if (etat.envoye) return;
      etat.envoye = true;
      // `fetch` avec `keepalive` plutôt que `navigator.sendBeacon`, et c'est
      // un choix : les deux portent la même limite de 64 Kio (MDN), mais
      // sendBeacon ne laisse pas maîtriser la requête, et cette route-ci
      // exige un en-tête Origin de même origine et un corps JSON
      // (app/api/events/route.ts). MDN désigne exactement ce cas : « To send
      // a request with a different method, to modify the request, or to read
      // the response, instead use the fetch() method with keepalive set to
      // true. » C'est de plus le transport déjà éprouvé en production sur
      // cette route par FirstPartyView.
      void fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          event: "page_engagement",
          engagement: mesure(etat, Date.now()),
          attribution: currentAttribution(),
        }),
      }).catch(() => undefined);
    };

    const relever = () => {
      frameDemandee = false;
      // La seule lecture de mise en page du module, une fois par image.
      noterDefilement(
        etat,
        pourcentageVu(window.scrollY, window.innerHeight, document.documentElement.scrollHeight),
      );
    };

    const auDefilement = () => {
      noterGeste(etat, Date.now());
      // Le drapeau vient de l'ÉVÉNEMENT : la part vue, elle, compte déjà le
      // premier écran et ne dirait jamais « n'a pas défilé ».
      noterPageBougee(etat);
      if (frameDemandee) return;
      frameDemandee = true;
      window.requestAnimationFrame(relever);
    };

    const auGeste = () => noterGeste(etat, Date.now());

    const auChangementDeVisibilite = () => {
      const visible = document.visibilityState === "visible";
      noterVisibilite(etat, visible, Date.now());
      if (!visible) envoyer();
    };

    const auRetourDuCache = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // Page restaurée : le relevé précédent est parti, celui-ci recommence.
      etat = nouvelEtat(Date.now());
    };

    // La page est déjà affichée quand l'effet tourne : on relève la part
    // visible d'emblée, sinon une page qu'on ne défile pas du tout vaudrait
    // zéro alors qu'un écran entier a été vu.
    relever();

    window.addEventListener("scroll", auDefilement, { passive: true });
    window.addEventListener("pointerdown", auGeste, { passive: true });
    window.addEventListener("touchstart", auGeste, { passive: true });
    window.addEventListener("keydown", auGeste);
    document.addEventListener("visibilitychange", auChangementDeVisibilite);
    window.addEventListener("pagehide", envoyer);
    window.addEventListener("pageshow", auRetourDuCache);
    const debrancherChamp = brancherChamp((onglet) => noterChamp(etat, onglet, Date.now()));

    return () => {
      window.removeEventListener("scroll", auDefilement);
      window.removeEventListener("pointerdown", auGeste);
      window.removeEventListener("touchstart", auGeste);
      window.removeEventListener("keydown", auGeste);
      document.removeEventListener("visibilitychange", auChangementDeVisibilite);
      window.removeEventListener("pagehide", envoyer);
      window.removeEventListener("pageshow", auRetourDuCache);
      debrancherChamp();
      // Navigation côté client : la page est quittée sans que le document le
      // soit, donc ni visibilitychange ni pagehide ne se déclencheront.
      // Le relevé part ici, sinon il ne partirait jamais.
      noterVisibilite(etat, false, Date.now());
      envoyer();
    };
  }, []);

  return null;
}
