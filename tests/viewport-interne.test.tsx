import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_COOKIE, internalToken } from "@/lib/telemetry/internal";

const jar = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === INTERNAL_COOKIE && jar.value ? { value: jar.value } : undefined }),
}));

const { InternalViewportGate } = await import("@/components/internal-viewport-gate");

beforeEach(() => {
  vi.stubEnv("IP_HASH_SALT", "sonde-locale-test");
  jar.value = null;
});

describe("sonde de viewport réservée au navigateur interne", () => {
  it("n'envoie aucun bandeau à un visiteur sans cookie ou avec un cookie invalide", async () => {
    expect(await InternalViewportGate()).toBeNull();
    jar.value = "faux";
    expect(await InternalViewportGate()).toBeNull();
  });

  it("rend le bandeau uniquement avec le cookie interne signé", async () => {
    jar.value = internalToken("sonde-locale-test");
    const html = renderToStaticMarkup(await InternalViewportGate());
    expect(html).toContain("data-internal-viewport");
  });
});
