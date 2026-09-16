import type { SessionUser } from "@/lib/auth/session";
import { displayedPlan, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { FREE_ANALYSES, PRO_ANALYSES_PER_PERIOD } from "@/lib/billing/plans";
import { hashIp } from "@/lib/security/request";
import { hitUsageGuard, releaseUsageGuard } from "@/lib/security/usage-guard";
import { adjustInteger, countRows, selectRows } from "@/lib/supabase/server";

// Droit d'analyser, décidé uniquement côté serveur, avant l'appel au modèle.
// Le droit est réservé avant l'appel et rendu si l'analyse échoue : une
// analyse ratée ne consomme jamais rien.

// Analyse gratuite comptée aussi par IP hachée, sur 30 jours, pour limiter
// le contournement par suppression du cookie.
const FREE_IP_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export type Denial = { allowed: false; reason: "free_used" | "no_credit"; message: string };
export type Grant = { allowed: true; plan: "free" | "pack" | "pro"; release: () => Promise<void> };

const NO_CREDIT_MESSAGE = "Tu as utilisé ton analyse gratuite. Choisis une offre pour analyser d'autres deals.";

function freeIpKey(ip: string): string {
  return hashIp(`free-analysis:${ip}`);
}

async function reserveFree(ip: string): Promise<Grant | Denial> {
  const key = freeIpKey(ip);
  const guard = await hitUsageGuard(key, { limit: FREE_ANALYSES, windowSeconds: FREE_IP_WINDOW_SECONDS });
  if (!guard.allowed) {
    await releaseUsageGuard(key);
    return { allowed: false, reason: "free_used", message: NO_CREDIT_MESSAGE };
  }
  return { allowed: true, plan: "free", release: () => releaseUsageGuard(key) };
}

// Un crédit acheté se réserve de la même façon partout : décrément atomique,
// restitution à l'identique si l'analyse échoue. La colonne `plan` n'est pas
// filtrée : elle vaut encore « pro » sur un abonnement expiré ou en dépassement.
async function reservePackCredit(userId: string): Promise<Grant | null> {
  const filter = `user_id=eq.${userId}`;
  const reserved = await adjustInteger("credits", filter, "balance", -1, (balance) => balance > 0);
  if (reserved === null) return null;
  return {
    allowed: true,
    plan: "pack",
    release: async () => {
      await adjustInteger("credits", filter, "balance", 1, () => true);
    },
  };
}

type Context = { user: SessionUser | null; anonToken: string | null; ip: string };

export async function reserveAnalysis({ user, anonToken, ip }: Context): Promise<Grant | Denial> {
  if (!user) {
    // Visiteur anonyme : une analyse, comptée sur le jeton et sur l'IP.
    if (anonToken) {
      const done = await selectRows<{ id: string }>(
        "deals",
        `select=id&anon_token=eq.${encodeURIComponent(anonToken)}&status=eq.analysed&limit=1`,
      );
      if (done.length > 0) return { allowed: false, reason: "free_used", message: NO_CREDIT_MESSAGE };
    }
    return reserveFree(ip);
  }

  const [credits] = await selectRows<PlanState>(
    "credits",
    `select=plan,balance,period_end&user_id=eq.${user.id}&limit=1`,
  );

  // Le droit suit ce que le compte a réellement, pas la colonne `plan` : un
  // abonnement expiré retombe sur ses crédits restants, comme à l'affichage.
  const effectivePlan = displayedPlan(credits ?? null);

  if (effectivePlan === "pro") {
    // period_end fait foi : la période courante est le mois qui le précède.
    const periodEnd = periodEndsAt(credits ?? null) as Date;
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);
    const used = await countRows(
      "analyses",
      `select=id,deal:deals!inner(user_id)&deal.user_id=eq.${user.id}&created_at=gt.${periodStart.toISOString()}&created_at=lte.${periodEnd.toISOString()}`,
    );
    if (used < PRO_ANALYSES_PER_PERIOD) {
      return { allowed: true, plan: "pro", release: async () => undefined };
    }
    // Quota mensuel épuisé : les crédits achetés prennent le relais. Ils sont
    // promis sans date d'expiration, ils doivent donc servir ici aussi.
    const overflow = await reservePackCredit(user.id);
    if (overflow) return overflow;
    return { allowed: false, reason: "no_credit", message: "Tu as atteint la limite de ton abonnement pour cette période." };
  }

  if (effectivePlan === "pack") {
    const reserved = await reservePackCredit(user.id);
    if (reserved) return reserved;
    return { allowed: false, reason: "no_credit", message: "Tu n'as plus de crédit. Choisis une offre pour continuer." };
  }

  // Plus aucun crédit : un compte qui a déjà payé ne repasse pas par l'offre
  // gratuite, et le message dit ce qui s'est terminé.
  if (credits?.plan === "pro") {
    return { allowed: false, reason: "no_credit", message: "Ton abonnement n'est plus actif. Choisis une offre pour continuer." };
  }
  if (credits?.plan === "pack") {
    return { allowed: false, reason: "no_credit", message: "Tu n'as plus de crédit. Choisis une offre pour continuer." };
  }

  // Compte gratuit : l'analyse gratuite n'est disponible que si le compte n'en a
  // encore aucune, y compris celle faite anonymement puis rattachée.
  const owned = await selectRows<{ id: string }>(
    "deals",
    `select=id&user_id=eq.${user.id}&status=eq.analysed&limit=${FREE_ANALYSES}`,
  );
  if (owned.length >= FREE_ANALYSES) return { allowed: false, reason: "no_credit", message: NO_CREDIT_MESSAGE };
  return reserveFree(ip);
}
