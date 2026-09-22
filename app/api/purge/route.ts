import { createHash, timingSafeEqual } from "node:crypto";
import { recoverPendingWhopEvents, settleUnpaidCounterparts } from "@/lib/billing/webhook-recovery";
import { runPurge } from "@/lib/privacy/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Purge quotidienne, appelée par Vercel Cron (vercel.json). Vercel envoie
// « Authorization: Bearer <CRON_SECRET> » quand la variable CRON_SECRET est
// définie : sans ce secret exact, rien n'est fait.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  // Comparaison à temps constant, sur des empreintes de même longueur.
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const received = createHash("sha256").update(header).digest();
  return timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    console.warn(JSON.stringify({ event: "purge_refused" }));
    return Response.json({ error: "non autorisé" }, { status: 401 });
  }
  try {
    // Rattrapage des paiements d'abord (mission #060) : un compte non crédité
    // attend, la purge non. Branché sur ce cron, pas sur un second.
    const paiements = await recoverPendingWhopEvents().catch((caught: unknown) => {
      console.error(
        JSON.stringify({
          event: "whop_rattrapage_error",
          detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
        }),
      );
      return null;
    });
    // Mission #092 : paiements Pro restés sans activation, et paiements sans
    // compte correspondant depuis plus de 30 jours.
    const contreparties = await settleUnpaidCounterparts().catch((caught: unknown) => {
      console.error(
        JSON.stringify({
          event: "whop_contreparties_error",
          detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
        }),
      );
      return null;
    });
    const report = { ...(await runPurge()), paiements, contreparties };
    console.log(JSON.stringify({ event: "purge", ...report }));
    return Response.json(report);
  } catch (caught) {
    console.error(
      JSON.stringify({ event: "purge_error", detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu" }),
    );
    return Response.json({ error: "purge incomplète" }, { status: 500 });
  }
}
