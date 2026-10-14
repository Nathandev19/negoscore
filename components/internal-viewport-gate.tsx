import { cookies } from "next/headers";
import { InternalViewportProbe } from "@/components/internal-viewport-probe";
import { INTERNAL_COOKIE, internalSecret, internalTokenValid } from "@/lib/telemetry/internal";

export async function InternalViewportGate() {
  const cookie = (await cookies()).get(INTERNAL_COOKIE)?.value;
  if (!internalTokenValid(cookie, internalSecret())) return null;
  return <InternalViewportProbe />;
}
