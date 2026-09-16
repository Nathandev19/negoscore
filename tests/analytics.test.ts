import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

// posthog-js est remplacé : on vérifie ce qui lui est réellement passé.
const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: posthog }));

const OFFER = "On te propose 300 € pour 2 vidéos TikTok, marque Ondulia, lea@exemple.fr";

async function freshModule() {
  vi.resetModules();
  return import("@/lib/analytics/client");
}

beforeEach(() => {
  posthog.init.mockClear();
  posthog.capture.mockClear();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  vi.stubGlobal("navigator", { doNotTrack: null });
  vi.stubGlobal("window", { doNotTrack: null });
});

describe("mesure d'audience", () => {
  it("n'envoie que les propriétés fournies, sans donnée de deal ni email", async () => {
    const { initAnalytics, track } = await freshModule();
    initAnalytics();
    track(ANALYTICS_EVENTS.analysisCompleted, {
      method: "paste",
      latency_ms: 12000,
      confidence: "medium",
      score_band: "fair",
      has_price: true,
    });

    expect(posthog.capture).toHaveBeenCalledTimes(1);
    const [event, properties] = posthog.capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("analysis_completed");
    expect(Object.keys(properties).sort()).toEqual(["confidence", "has_price", "latency_ms", "method", "score_band"]);
    const serialized = JSON.stringify(properties);
    for (const forbidden of ["Ondulia", "exemple.fr", "300", OFFER]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("désactive l'enregistrement de session et masque les identifiants dans les URL", async () => {
    const { initAnalytics } = await freshModule();
    initAnalytics();
    const config = posthog.init.mock.calls[0][1] as {
      disable_session_recording: boolean;
      autocapture: boolean;
      respect_dnt: boolean;
      person_profiles: string;
      sanitize_properties: (p: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(config.disable_session_recording).toBe(true);
    expect(config.autocapture).toBe(false);
    expect(config.respect_dnt).toBe(true);
    expect(config.person_profiles).toBe("never");

    const cleaned = config.sanitize_properties({
      $current_url: "https://negoscore.fr/analyse/resultat/7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e",
      method: "paste",
    });
    expect(cleaned.$current_url).toBe("https://negoscore.fr/analyse/resultat/:id");
    expect(cleaned.method).toBe("paste");
  });

  it("respecte Do Not Track : aucune initialisation, aucun envoi", async () => {
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    const { initAnalytics, track } = await freshModule();
    initAnalytics();
    track(ANALYTICS_EVENTS.landingView);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("sans clé, l'application n'envoie rien", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const { initAnalytics, track } = await freshModule();
    initAnalytics();
    track(ANALYTICS_EVENTS.landingView);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  // La mission en annonce 15 ; la liste qu'elle donne en contient 14, tous repris ici.
  it("les événements attendus sont déclarés, dans l'ordre de la mission", () => {
    expect(Object.values(ANALYTICS_EVENTS)).toEqual([
      "landing_view",
      "input_started",
      "analysis_submitted",
      "analysis_completed",
      "analysis_failed",
      "result_viewed",
      "paywall_email_shown",
      "email_submitted",
      "magic_link_clicked",
      "message_copied",
      "second_analysis_attempt",
      "paywall_payment_shown",
      "checkout_started",
      "purchase_completed",
    ]);
  });
});
