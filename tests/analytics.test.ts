import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { sanitizeDistinctId } from "@/lib/analytics/distinct-id";
import { isCredited } from "@/components/merci/credits-waiter";

// posthog-js est remplacé : on vérifie ce qui lui est réellement passé.
const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn(), get_distinct_id: vi.fn(() => "01924f3a-anon-id") }));
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

describe("identifiant anonyme transmis au paiement", () => {
  it("accepte un identifiant PostHog, refuse le reste", () => {
    expect(sanitizeDistinctId("01924f3a-7c21-7a4e-8f3e-anon_id")).toBe("01924f3a-7c21-7a4e-8f3e-anon_id");
    expect(sanitizeDistinctId("  01924f3a  ")).toBe("01924f3a");
    expect(sanitizeDistinctId("a".repeat(200))).toHaveLength(200);
    expect(sanitizeDistinctId("a".repeat(201))).toBeNull();
    expect(sanitizeDistinctId("lea@exemple.fr")).toBeNull();
    expect(sanitizeDistinctId("id avec espace")).toBeNull();
    expect(sanitizeDistinctId("<script>")).toBeNull();
    expect(sanitizeDistinctId("")).toBeNull();
    expect(sanitizeDistinctId(null)).toBeNull();
    expect(sanitizeDistinctId(undefined)).toBeNull();
    expect(sanitizeDistinctId(42)).toBeNull();
  });

  it("expose l'identifiant du navigateur une fois la mesure initialisée", async () => {
    const { initAnalytics, analyticsDistinctId } = await freshModule();
    expect(analyticsDistinctId()).toBeNull();
    initAnalytics();
    expect(analyticsDistinctId()).toBe("01924f3a-anon-id");
  });

  it("ne renvoie rien quand la mesure est désactivée", async () => {
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    const { initAnalytics, analyticsDistinctId } = await freshModule();
    initAnalytics();
    expect(analyticsDistinctId()).toBeNull();
  });
});

describe("page Merci : compte déjà crédité", () => {
  it("considère le compte crédité dès que le solde ou le plan le montrent", () => {
    expect(isCredited({ plan: "pack", balance: 3, period_end: null })).toBe(true);
    expect(isCredited({ plan: "pro", balance: 0, period_end: "2026-10-16T00:00:00.000Z" })).toBe(true);
    expect(isCredited({ plan: "free", balance: 2, period_end: null })).toBe(true);
  });

  it("reste en attente tant que le compte est à zéro", () => {
    expect(isCredited({ plan: "free", balance: 0, period_end: null })).toBe(false);
    expect(isCredited(null)).toBe(false);
  });
});

// Mission #050 partie D — les résidus de l'ancienne configuration sont effacés
// au premier chargement, sans toucher aux cookies du site.
describe("nettoyage des résidus de mesure", () => {
  function fakeBrowser(cookies: string[], local: Record<string, string>, session: Record<string, string>) {
    const jar = new Map(cookies.map((c) => [c.split("=")[0], c.split("=")[1] ?? ""]));
    const expired: string[] = [];
    const store = (data: Record<string, string>) => {
      const fake: Record<string, unknown> = {
        ...data,
        removeItem: (key: string) => {
          delete fake[key];
        },
      };
      return fake;
    };
    const doc = {
      get cookie() {
        return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
      },
      set cookie(written: string) {
        const name = written.split("=")[0];
        if (/Max-Age=0/.test(written)) {
          expired.push(name);
          jar.delete(name);
        }
      },
    };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", {
      doNotTrack: null,
      location: { hostname: "www.negoscore.fr" },
      localStorage: store(local),
      sessionStorage: store(session),
    });
    return { jar, expired };
  }

  it("efface les cookies ph_ et les clés posthog, et rien d'autre", async () => {
    const { jar, expired } = fakeBrowser(
      ["ph_phc_abc_posthog=jeton", "sb_access_token=session", "ns_session=1", "negoscore_niveau=starter", "deal_anon_token=jeton"],
      { "ph_phc_abc_posthog": "x", POSTHOG_state: "y", negoscore_brouillon: "mon texte" },
      { posthog_surveys: "z", autre: "intact" },
    );
    const { clearAnalyticsResidue } = await freshModule();
    clearAnalyticsResidue();

    expect([...jar.keys()]).toEqual(["sb_access_token", "ns_session", "negoscore_niveau", "deal_anon_token"]);
    expect(expired.every((name) => name.startsWith("ph_"))).toBe(true);
    expect(Object.keys(window.localStorage).filter((k) => typeof window.localStorage[k] === "string")).toEqual([
      "negoscore_brouillon",
    ]);
    expect(Object.keys(window.sessionStorage).filter((k) => typeof window.sessionStorage[k] === "string")).toEqual(["autre"]);
  });

  it("ne lève rien quand le stockage est inaccessible", async () => {
    vi.stubGlobal("document", {
      get cookie(): string {
        throw new Error("cookies bloqués");
      },
      set cookie(_: string) {
        throw new Error("cookies bloqués");
      },
    });
    vi.stubGlobal("window", {
      location: { hostname: "www.negoscore.fr" },
      get localStorage(): Storage {
        throw new Error("stockage bloqué");
      },
      get sessionStorage(): Storage {
        throw new Error("stockage bloqué");
      },
    });
    const { clearAnalyticsResidue } = await freshModule();
    expect(() => clearAnalyticsResidue()).not.toThrow();
  });
});
