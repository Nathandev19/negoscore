// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageEngagement } from "@/components/analytics/page-engagement";
import { brancherChamp, signalerChamp } from "@/lib/analytics/engagement";

// Mission #209 — LE RELEVÉ, DANS UN VRAI DOM.
//
// Ce qui tient au navigateur ne peut pas se vérifier « à la source » : les
// missions #200 à #203 ont appris ce que coûte une garde qui lit du code au
// lieu de l'exécuter. On monte donc le composant, on fait défiler, on cache
// l'onglet, et on regarde ce qui part.
//
// CE QUI EST SURVEILLÉ ICI est ce qui rendrait la mesure fausse ou indiscrète :
//   - un élément ajouté à l'écran, alors que la mission l'interdit ;
//   - un envoi pendant la lecture, alors qu'il doit y en avoir UN, au départ ;
//   - deux envois pour une seule page vue ;
//   - un contenu, une durée exacte ou un identifiant dans le corps envoyé.

const envois: Array<{ url: string; body: Record<string, unknown> }> = [];

function brancherFetch() {
  const feint = vi.fn(async (url: string, init?: RequestInit) => {
    envois.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return { ok: true, status: 204 } as Response;
  });
  vi.stubGlobal("fetch", feint);
  return feint;
}

// jsdom ne défile pas : on pose la géométrie à la main, puis on émet
// l'événement que le navigateur aurait émis.
function geometrie({ scrollY, viewport, hauteur }: { scrollY: number; viewport: number; hauteur: number }) {
  Object.defineProperty(window, "scrollY", { value: scrollY, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: viewport, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: hauteur, writable: true, configurable: true });
}

function cacherLOnglet() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function montrerLOnglet() {
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  envois.length = 0;
  montrerLOnglet();
  geometrie({ scrollY: 0, viewport: 800, hauteur: 4_000 });
  // requestAnimationFrame synchrone : le relevé de défilement est coalescé
  // dans une image, et on veut l'observer sans attendre.
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    fn(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("rien à l'écran, rien pendant la lecture", () => {
  it("LE COMPOSANT NE REND RIEN : aucun élément ajouté, aucun style", async () => {
    brancherFetch();
    const { container } = render(<PageEngagement />);
    expect(container.innerHTML).toBe("");
  });

  it("AUCUN ENVOI PENDANT LA LECTURE : défiler, cliquer, taper n'envoie rien", async () => {
    const feint = brancherFetch();
    render(<PageEngagement />);
    geometrie({ scrollY: 1_200, viewport: 800, hauteur: 4_000 });
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("keydown"));
    signalerChamp("text");
    expect(feint).not.toHaveBeenCalled();
  });
});

describe("l'envoi, au départ de la page", () => {
  it("l'onglet se cache : UN envoi, sur la route d'événements existante", async () => {
    const feint = brancherFetch();
    render(<PageEngagement />);
    cacherLOnglet();
    expect(feint).toHaveBeenCalledTimes(1);
    expect(envois[0].url).toBe("/api/events");
    expect(envois[0].body.event).toBe("page_engagement");
    // keepalive : la requête survit au départ de la page.
    expect(feint.mock.calls[0][1]?.keepalive).toBe(true);
  });

  it("UN SEUL ENVOI PAR PAGE VUE, même si les deux événements de départ tombent", async () => {
    // MDN dit d'écouter visibilitychange, web.dev dit d'écouter pagehide, et
    // aucune des deux ne couvre ce que l'autre couvre. On écoute les deux, et
    // l'envoi est idempotent — sinon une page vue compterait deux fois.
    const feint = brancherFetch();
    render(<PageEngagement />);
    cacherLOnglet();
    window.dispatchEvent(new Event("pagehide"));
    cacherLOnglet();
    expect(feint).toHaveBeenCalledTimes(1);
  });

  it("pagehide seul suffit : c'est le cas où visibilitychange ne vient pas", async () => {
    const feint = brancherFetch();
    render(<PageEngagement />);
    window.dispatchEvent(new Event("pagehide"));
    expect(feint).toHaveBeenCalledTimes(1);
  });

  it("une navigation côté client envoie aussi : ni l'un ni l'autre ne se déclenche", async () => {
    // Le document n'est pas quitté, donc aucun des deux événements ne tombe.
    // Sans cet envoi au démontage, la page vue serait perdue.
    const feint = brancherFetch();
    const { unmount } = render(<PageEngagement />);
    unmount();
    expect(feint).toHaveBeenCalledTimes(1);
  });

  it("UN RETOUR PAR LE CACHE DE NAVIGATION ARRIÈRE compte comme une nouvelle lecture", async () => {
    const feint = brancherFetch();
    render(<PageEngagement />);
    cacherLOnglet();
    expect(feint).toHaveBeenCalledTimes(1);
    // Page restaurée : le relevé précédent est parti, celui-ci recommence.
    montrerLOnglet();
    const retour = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(retour, "persisted", { value: true });
    window.dispatchEvent(retour);
    cacherLOnglet();
    expect(feint).toHaveBeenCalledTimes(2);
  });

  it("un pageshow ORDINAIRE ne remet pas le compteur à zéro", async () => {
    const feint = brancherFetch();
    render(<PageEngagement />);
    const ordinaire = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(ordinaire, "persisted", { value: false });
    window.dispatchEvent(ordinaire);
    cacherLOnglet();
    cacherLOnglet();
    expect(feint).toHaveBeenCalledTimes(1);
  });
});

describe("ce que le relevé contient", () => {
  it("les quatre signaux, en TRANCHES", async () => {
    brancherFetch();
    render(<PageEngagement />);
    geometrie({ scrollY: 3_200, viewport: 800, hauteur: 4_000 });
    window.dispatchEvent(new Event("scroll"));
    signalerChamp("text");
    cacherLOnglet();
    expect(envois[0].body.engagement).toMatchObject({
      scroll: "90-100",
      input: "text",
      scrolled: true,
      dwell: "0-1s",
      first_action: "0-1s",
    });
  });

  it("UNE PAGE NON DÉFILÉE : « scrolled » est faux, et la part VUE n'est pas nulle", async () => {
    // Les deux disent des choses différentes, et c'est tout l'intérêt : sur
    // une page de 4 000 px lue sur un écran de 800, un cinquième est vu sans
    // qu'on ait touché à rien. Confondre les deux aurait fait disparaître le
    // signal « personne ne défile ».
    brancherFetch();
    const { unmount } = render(<PageEngagement />);
    cacherLOnglet();
    expect((envois[0].body.engagement as Record<string, unknown>).scroll).toBe("1-25");
    expect((envois[0].body.engagement as Record<string, unknown>).scrolled).toBe(false);
    expect((envois[0].body.engagement as Record<string, unknown>).first_action).toBe("aucun");
    unmount();

    envois.length = 0;
    montrerLOnglet();
    geometrie({ scrollY: 0, viewport: 900, hauteur: 600 });
    render(<PageEngagement />);
    cacherLOnglet();
    expect((envois[0].body.engagement as Record<string, unknown>).scroll).toBe("90-100");
  });

  it("RIEN QUE DES TRANCHES ET UNE ATTRIBUTION : aucune donnée, aucun identifiant", async () => {
    brancherFetch();
    render(<PageEngagement />);
    geometrie({ scrollY: 1_000, viewport: 800, hauteur: 4_000 });
    window.dispatchEvent(new Event("scroll"));
    signalerChamp("photo");
    cacherLOnglet();

    const brut = JSON.stringify(envois[0].body);
    // Le corps entier : trois clés, pas une de plus.
    expect(Object.keys(envois[0].body).sort()).toEqual(["attribution", "engagement", "event"]);
    // Aucune durée exacte, aucun horodatage : les nombres à quatre chiffres et
    // plus n'ont rien à faire là.
    expect(brut).not.toMatch(/\d{4,}/);
    // Et aucun mot qui ressemblerait à du contenu d'offre ou à un identifiant.
    for (const mot of ["€", "message", "texte", "montant", "user", "id"]) {
      expect(brut, mot).not.toContain(mot);
    }
  });

  it("le refus de suivi du navigateur arrête tout, avant le premier écouteur", async () => {
    const feint = brancherFetch();
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    try {
      render(<PageEngagement />);
      window.dispatchEvent(new Event("scroll"));
      cacherLOnglet();
      window.dispatchEvent(new Event("pagehide"));
      expect(feint).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
    }
  });

  it("LE TEMPS EN ONGLET CACHÉ N'EST PAS COMPTÉ comme du temps de lecture", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      brancherFetch();
      render(<PageEngagement />);
      cacherLOnglet();
      // Trente secondes d'onglet caché, puis retour et départ immédiat.
      await vi.advanceTimersByTimeAsync(30_000);
      montrerLOnglet();
      window.dispatchEvent(new Event("pagehide"));
      // Le premier envoi est parti au moment où l'onglet s'est caché, avec
      // moins d'une seconde de lecture. Les trente secondes ne comptent pas.
      expect((envois[0].body.engagement as Record<string, unknown>).dwell).toBe("0-1s");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("le champ de collage, touché pour de vrai", () => {
  it("TAPER DANS LA ZONE signale le contact — le crochet est rebranché", async () => {
    // La batterie de mutation a montré que retirer `signalerChamp(current)` de
    // deal-input ne cassait rien : les tests appelaient la fonction
    // directement, jamais le formulaire. Ici on tape dans la vraie zone de
    // texte du vrai composant.
    const { render: rendre } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
      usePathname: () => "/",
      useSearchParams: () => new URLSearchParams(),
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const { DealInput } = await import("@/components/deal-input");

    const recus: string[] = [];
    const retirer = brancherChamp((onglet) => recus.push(onglet));
    try {
      const user = userEvent.setup();
      rendre(<DealInput />);
      const zone = await screen.findByPlaceholderText(/Colle ici le DM/);
      await user.click(zone);
      await user.paste("Bonjour, on te propose 300 € pour deux vidéos TikTok.");
      // Un seul signalement, même après plusieurs frappes : c'est le PREMIER
      // contact qu'on relève, pas une suite d'actions.
      await user.type(zone, " Merci !");
      expect(recus).toEqual(["text"]);
    } finally {
      retirer();
    }
  });

  it("et il ne transmet que l'ONGLET, jamais ce qui est écrit dedans", async () => {
    const { render: rendre } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
      usePathname: () => "/",
      useSearchParams: () => new URLSearchParams(),
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const { DealInput } = await import("@/components/deal-input");

    const recus: string[] = [];
    const retirer = brancherChamp((onglet) => recus.push(onglet));
    try {
      const user = userEvent.setup();
      rendre(<DealInput />);
      const zone = await screen.findByPlaceholderText(/Colle ici le DM/);
      await user.click(zone);
      await user.paste("1 800 € et exclusivité trois mois");
      expect(recus.join("|")).toBe("text");
      expect(recus.join("|")).not.toContain("800");
      expect(recus.join("|")).not.toContain("€");
    } finally {
      retirer();
    }
  });
});
