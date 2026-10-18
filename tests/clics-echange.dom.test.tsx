// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NegotiationThread } from "@/components/result/negotiation/negotiation-thread";
import { CONCLUSION_LABEL, THREAD_READING_LABEL } from "@/components/result/negotiation/thread-status";
import { MIN_REPLY_LENGTH, TOO_SHORT_REPLY_MESSAGE } from "@/lib/negotiation/libelles";
import { CONCLUSION_PENDING_ID, MIN_ATTENTE_MS, THREAD_PENDING_ID } from "@/lib/ui/reveal";

// Mission #201, chantier C — LE PROJET CLIQUE SES BOUTONS.
//
// Les missions #099, #102 et #200 ont toutes fini par la même phrase :
// « vérifié à la source ». C'était la vérité disponible — le dépôt n'avait ni
// environnement DOM ni bibliothèque de rendu — mais lire `disabled={…}` dans
// un fichier ne dit pas qu'un second clic ne part pas. La #200 l'a montré de
// la pire façon : « aria-disabled={waiting !== null} » CONTIENT
// « disabled={waiting !== null} », et la garde de lecture passait sur un
// bouton resté cliquable.
//
// Ici on clique pour de bon, et on compte les requêtes.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// L'action serveur sans JavaScript tire toute la chaîne des routes (Supabase,
// le modèle, l'authentification) dans le test. Elle n'a aucun rôle ici : avec
// JavaScript, c'est onSubmit qui répond et l'action n'est jamais appelée.
vi.mock("@/lib/forms/no-js-actions", () => ({ saveTurnWithoutJs: vi.fn() }));

// Une requête qu'on résout à la main : tant qu'elle est en l'air, l'attente
// reste affichée et on peut l'observer.
function requeteSuspendue() {
  let repondre: (value: unknown) => void = () => undefined;
  const promesse = new Promise((resolve) => {
    repondre = resolve;
  });
  // L'URL demandée est une des choses qu'on vérifie : la feinte garde donc
  // la signature, sans quoi `mock.calls` n'a aucun argument à relire.
  const fetchFeint = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => promesse);
  vi.stubGlobal("fetch", fetchFeint);
  return {
    fetchFeint,
    reussir: () => repondre({ ok: true, status: 200, json: async () => ({}) }),
    echouer: (status: number, error: string) => repondre({ ok: false, status, json: async () => ({ error }) }),
  };
}

const FIL = { analysisId: "11111111-1111-4111-8111-111111111111", turns: [], conclusion: null, access: "open" as const };
const REPONSE = "Merci pour le retour. On peut monter à 1 800 € mais on garde l'exclusivité trois mois.".padEnd(MIN_REPLY_LENGTH, ".");

beforeEach(() => {
  refresh.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("« Analyser sa réponse » — le tour de suivi", () => {
  it("UN CLIC : l'attente s'affiche, le bouton se bloque, UNE requête part", async () => {
    const { fetchFeint, reussir } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    const zone = screen.getByPlaceholderText("Colle ici la réponse de la marque…");
    await user.click(zone);
    await user.paste(REPONSE);
    const bouton = screen.getByRole("button", { name: "Analyser sa réponse" });
    expect(bouton).toBeEnabled();

    await user.click(bouton);

    // Le panneau de la première analyse, pas une note à filet.
    await waitFor(() => expect(document.getElementById(THREAD_PENDING_ID)).not.toBeNull());
    expect(screen.getByText(THREAD_READING_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lecture de la réponse…" })).toBeDisabled();
    expect(fetchFeint).toHaveBeenCalledTimes(1);
    expect(fetchFeint.mock.calls[0]?.[0]).toBe(`/api/analyses/${FIL.analysisId}/tours`);

    reussir();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("DOUBLE CLIC : le second ne part pas — le bouton est vraiment désactivé", async () => {
    const { fetchFeint } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    await user.click(screen.getByPlaceholderText("Colle ici la réponse de la marque…"));
    await user.paste(REPONSE);
    const bouton = screen.getByRole("button", { name: "Analyser sa réponse" });

    await user.click(bouton);
    // Le MÊME élément, recliqué : c'est exactement le geste d'une personne
    // qui trouve que ça ne réagit pas.
    await user.click(bouton);
    await user.click(bouton);

    expect(fetchFeint).toHaveBeenCalledTimes(1);
  });

  it("le compteur de l'attente tourne : il n'est pas figé à zéro", async () => {
    const { fetchFeint } = requeteSuspendue();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<NegotiationThread {...FIL} />);
      await user.click(screen.getByPlaceholderText("Colle ici la réponse de la marque…"));
      await user.paste(REPONSE);
      await user.click(screen.getByRole("button", { name: "Analyser sa réponse" }));
      await waitFor(() => expect(fetchFeint).toHaveBeenCalled());

      const panneau = document.getElementById(THREAD_PENDING_ID);
      expect(panneau?.textContent).toContain("0 s");
      await vi.advanceTimersByTimeAsync(7_000);
      await waitFor(() => expect(document.getElementById(THREAD_PENDING_ID)?.textContent).toContain("7 s"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("une réponse trop courte n'envoie RIEN, et le dit", async () => {
    const { fetchFeint } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    await user.click(screen.getByPlaceholderText("Colle ici la réponse de la marque…"));
    await user.paste("ok");
    await user.click(screen.getByRole("button", { name: "Analyser sa réponse" }));

    expect(await screen.findByText(TOO_SHORT_REPLY_MESSAGE)).toBeInTheDocument();
    expect(fetchFeint).not.toHaveBeenCalled();
    expect(document.getElementById(THREAD_PENDING_ID)).toBeNull();
  });

  it("un refus rend le bouton, avec le message du serveur et le texte gardé", async () => {
    const { echouer } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    const zone = screen.getByPlaceholderText("Colle ici la réponse de la marque…");
    await user.click(zone);
    await user.paste(REPONSE);
    await user.click(screen.getByRole("button", { name: "Analyser sa réponse" }));
    echouer(422, "Ce texte ne répond pas à cette offre.");

    expect(await screen.findByText("Ce texte ne répond pas à cette offre.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyser sa réponse" })).toBeEnabled();
    expect(zone).toHaveValue(REPONSE);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("« J'accepte ces termes » — la conclusion", () => {
  it("UN CLIC : son propre panneau s'affiche, et il ne parle pas de lecture", async () => {
    const { fetchFeint, reussir } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    await user.click(screen.getByRole("button", { name: "J'accepte ces termes" }));

    await waitFor(() => expect(document.getElementById(CONCLUSION_PENDING_ID)).not.toBeNull());
    expect(screen.getByText(CONCLUSION_LABEL)).toBeInTheDocument();
    // Vraiment désactivé, pas seulement gardé en JavaScript : la batterie de
    // mutation a montré que sans cette ligne, retirer `disabled` ne cassait
    // rien — le garde de conclude() absorbait le second clic, et le bouton
    // restait enfonçable à l'écran pendant tout le traitement.
    expect(screen.getByRole("button", { name: "Préparation…" })).toBeDisabled();
    // La conclusion n'appelle pas le modèle : annoncer une lecture serait faux.
    expect(document.body.textContent).not.toContain(THREAD_READING_LABEL);
    expect(document.getElementById(THREAD_PENDING_ID)).toBeNull();
    expect(fetchFeint).toHaveBeenCalledTimes(1);
    expect(fetchFeint.mock.calls[0]?.[0]).toBe(`/api/analyses/${FIL.analysisId}/conclusion`);

    reussir();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("DOUBLE CLIC : une seule conclusion demandée", async () => {
    const { fetchFeint } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    const bouton = screen.getByRole("button", { name: "J'accepte ces termes" });
    await user.click(bouton);
    await user.click(bouton);
    await user.click(bouton);

    expect(fetchFeint).toHaveBeenCalledTimes(1);
  });

  it("pendant la conclusion, L'AUTRE bouton est bloqué aussi", async () => {
    const { fetchFeint } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    await user.click(screen.getByPlaceholderText("Colle ici la réponse de la marque…"));
    await user.paste(REPONSE);
    await user.click(screen.getByRole("button", { name: "J'accepte ces termes" }));

    const envoi = screen.getByRole("button", { name: "Analyser sa réponse" });
    expect(envoi).toBeDisabled();
    await user.click(envoi);
    expect(fetchFeint).toHaveBeenCalledTimes(1);
  });

  it("le panneau TIENT 900 ms même si le serveur répond tout de suite", async () => {
    // La conclusion n'appelle pas le modèle : sa requête peut revenir en
    // quelques dizaines de millisecondes. Sans plancher, le panneau
    // apparaîtrait et disparaîtrait dans le même souffle — ce qui se lit
    // comme un défaut d'affichage, pas comme un travail fait.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<NegotiationThread {...FIL} />);
      await user.click(screen.getByRole("button", { name: "J'accepte ces termes" }));

      await vi.advanceTimersByTimeAsync(MIN_ATTENTE_MS - 200);
      expect(refresh).not.toHaveBeenCalled();
      expect(document.getElementById(CONCLUSION_PENDING_ID)).not.toBeNull();

      await vi.advanceTimersByTimeAsync(400);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("un refus rend le bouton et montre le message", async () => {
    const { echouer } = requeteSuspendue();
    const user = userEvent.setup();
    render(<NegotiationThread {...FIL} />);

    await user.click(screen.getByRole("button", { name: "J'accepte ces termes" }));
    echouer(503, "La conclusion n'a pas pu être enregistrée. Réessaie plus tard.");

    expect(await screen.findAllByText("La conclusion n'a pas pu être enregistrée. Réessaie plus tard.")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "J'accepte ces termes" })).toBeEnabled();
    expect(document.getElementById(CONCLUSION_PENDING_ID)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
