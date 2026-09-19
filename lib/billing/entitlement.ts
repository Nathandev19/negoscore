import type { SessionUser } from "@/lib/auth/session";
import { consumeFree, freeUsed, type FreeSubject } from "@/lib/billing/free-usage";
import { displayedPlan, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { FREE_ANALYSES, PRO_ANALYSES_PER_PERIOD } from "@/lib/billing/plans";
import { NO_FREE_LEFT_MESSAGE } from "@/lib/billing/right-hint";
import { hashIp } from "@/lib/security/request";
import { hitUsageGuard, releaseUsageGuard } from "@/lib/security/usage-guard";
import { adjustInteger, countRows, isMissingColumn, isMissingRelation, selectRows } from "@/lib/supabase/server";

// Droit d'analyser, décidé uniquement côté serveur.
//
// Règle : aucun droit consommé sans résultat rendu. Le droit est VÉRIFIÉ avant
// l'appel au modèle, sans rien décompter. Il n'est DÉCOMPTÉ (commit) qu'après
// l'enregistrement d'une analyse valide. Si le modèle échoue, rien n'a été
// écrit : il n'y a rien à rendre, même si la fonction est coupée en plein appel.
// Si le décompte échoue (dernier crédit pris entre-temps par une autre analyse),
// la route supprime l'analyse qu'elle vient d'enregistrer.

// La gratuité se compte sur le jeton anonyme et sur le compte. L'IP, elle,
// n'est qu'un filet anti-script : derrière une même IP publique (réseau
// mobile, foyer, lycée, coworking) se trouvent des visiteurs différents, et
// les bloquer coûterait des clients pour économiser des fractions de centime.
// Seuil haut, fenêtre courte : seul un automate y touche.
const FREE_IP_LIMIT = 20;
const FREE_IP_WINDOW_SECONDS = 24 * 60 * 60;

export type Denial = {
  allowed: false;
  reason: "free_used" | "no_credit" | "rate_limited" | "plan_required";
  message: string;
};

export type Grant = {
  allowed: true;
  // "retry" : relance gratuite d'une analyse incomplète (lib/analysis/retry.ts),
  // accordée par la route, jamais par reserveAnalysis.
  plan: "free" | "pack" | "pro" | "retry";
  // Décompte, après l'enregistrement de l'analyse. false : plus de droit.
  commit: () => Promise<boolean>;
  // Annule ce que la vérification a compté (filet anti-script de l'IP).
  release: () => Promise<void>;
};

const NO_CREDIT_MESSAGE = NO_FREE_LEFT_MESSAGE;
const NO_PACK_CREDIT_MESSAGE = "Tu n'as plus de crédit. Choisis une formule pour continuer.";
const RATE_LIMITED_MESSAGE =
  "Trop d'analyses ont été lancées depuis ton réseau ces dernières heures. Réessaie plus tard, ou connecte-toi pour continuer.";

const nothingToRelease = async () => undefined;

// Analyses du compte sur la période, relances gratuites exclues (is_retry,
// migration 018) : une relance d'analyse incomplète ne consomme pas le quota.
// Sans la migration, la colonne n'existe pas et aucune relance n'a pu être
// enregistrée : on compte toutes les analyses, comme avant.
async function analysesInPeriod(userId: string, start: Date, end: Date): Promise<number> {
  const query = `select=id,deal:deals!inner(user_id)&deal.user_id=eq.${userId}&created_at=gt.${start.toISOString()}&created_at=lte.${end.toISOString()}`;
  let analyses: number;
  try {
    // Lecture plutôt que comptage : une requête HEAD ne renvoie pas le code d'erreur
    // qui distingue une colonne absente. Le quota est petit, la lecture aussi.
    const rows = await selectRows<{ id: string }>("analyses", `${query}&is_retry=is.false&limit=${PRO_ANALYSES_PER_PERIOD + 1}`);
    analyses = rows.length;
  } catch (caught) {
    if (!isMissingColumn(caught)) throw caught;
    analyses = await countRows("analyses", query);
  }
  return analyses + (await turnsInPeriod(userId, start, end));
}

// Mission #080, D1 — un tour de négociation compte comme une analyse dans le
// quota Pro. Table absente (migration 022 non appliquée) : aucun tour n'a pu
// être enregistré, donc zéro.
async function turnsInPeriod(userId: string, start: Date, end: Date): Promise<number> {
  try {
    const rows = await selectRows<{ id: string }>(
      "negotiation_turns",
      `select=id&user_id=eq.${userId}&kind=eq.reply&created_at=gt.${start.toISOString()}&created_at=lte.${end.toISOString()}&limit=${PRO_ANALYSES_PER_PERIOD + 1}`,
    );
    return rows.length;
  } catch (caught) {
    if (isMissingRelation(caught)) return 0;
    throw caught;
  }
}

function freeIpKey(ip: string): string {
  return hashIp(`free-analysis:${ip}`);
}

// Décompte d'une gratuité : compteur durable, ou, avant la migration 015,
// nombre de deals analysés (celui qui vient d'être enregistré compris).
async function commitFree(subject: FreeSubject): Promise<boolean> {
  const consumed = await consumeFree(subject, FREE_ANALYSES);
  if (consumed !== "missing") return consumed;
  const owner = subject.kind === "anon" ? `anon_token=eq.${encodeURIComponent(subject.token)}` : `user_id=eq.${subject.id}`;
  const analysed = await countRows("deals", `select=id&${owner}&status=eq.analysed`);
  return analysed <= FREE_ANALYSES;
}

async function grantFree(ip: string, subject: FreeSubject): Promise<Grant | Denial> {
  const key = freeIpKey(ip);
  const guard = await hitUsageGuard(key, { limit: FREE_IP_LIMIT, windowSeconds: FREE_IP_WINDOW_SECONDS });
  if (!guard.allowed) {
    await releaseUsageGuard(key);
    // Journalisé pour savoir si ce filet se déclenche vraiment en production.
    // L'IP n'apparaît pas : seule sa version hachée sert de compteur.
    console.warn(
      JSON.stringify({
        event: "free_ip_rate_limited",
        reason: "rate_limited",
        count: guard.count,
        limit: FREE_IP_LIMIT,
        window_hours: FREE_IP_WINDOW_SECONDS / 3600,
      }),
    );
    return { allowed: false, reason: "rate_limited", message: RATE_LIMITED_MESSAGE };
  }
  return { allowed: true, plan: "free", commit: () => commitFree(subject), release: () => releaseUsageGuard(key) };
}

// Crédit acheté : vérifié maintenant, décrémenté au commit par compare-and-swap.
// La colonne `plan` n'est pas filtrée : elle vaut encore « pro » sur un
// abonnement expiré ou en dépassement.
function grantPack(userId: string): Grant {
  return {
    allowed: true,
    plan: "pack",
    commit: async () =>
      (await adjustInteger("credits", `user_id=eq.${userId}`, "balance", -1, (balance) => balance > 0)) !== null,
    release: nothingToRelease,
  };
}

async function freeAlreadyUsed(subject: FreeSubject): Promise<boolean> {
  const used = await freeUsed(subject);
  if (used !== "missing" && used >= FREE_ANALYSES) return true;
  const owner = subject.kind === "anon" ? `anon_token=eq.${encodeURIComponent(subject.token)}` : `user_id=eq.${subject.id}`;
  const done = await selectRows<{ id: string }>("deals", `select=id&${owner}&status=eq.analysed&limit=${FREE_ANALYSES}`);
  return done.length >= FREE_ANALYSES;
}

// Analyse gratuite déjà consommée par ce compte (mission #067, page /compte).
// Lecture seule, même règle que le droit réel : compteur durable, ou analyses
// déjà faites. Ne réserve et ne compte rien.
export async function accountFreeAnalysisUsed(userId: string): Promise<boolean> {
  return freeAlreadyUsed({ kind: "user", id: userId });
}

type Context = {
  user: SessionUser | null;
  // Jeton anonyme lu dans la requête : sert à savoir si la gratuité est déjà prise.
  anonToken: string | null;
  // Jeton sous lequel l'analyse sera enregistrée (le même, ou un nouveau posé
  // par la route) : sert au décompte.
  commitAnonToken?: string | null;
  ip: string;
};

// Décision seule, sans rien réserver ni compter : partagée par reserveAnalysis
// et par analysisRightStatus (affichage « il ne te reste aucun droit » avant la
// saisie, mission #046).
type RightDecision =
  | Denial
  | { allowed: true; plan: "free" }
  | { allowed: true; plan: "pack" }
  | { allowed: true; plan: "pro"; inPeriod: () => Promise<number> };

async function decideRight(user: SessionUser | null, anonToken: string | null): Promise<RightDecision> {
  if (!user) {
    if (anonToken && (await freeAlreadyUsed({ kind: "anon", token: anonToken }))) {
      return { allowed: false, reason: "free_used", message: NO_CREDIT_MESSAGE };
    }
    return { allowed: true, plan: "free" };
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
    const inPeriod = () => analysesInPeriod(user.id, periodStart, periodEnd);
    if ((await inPeriod()) < PRO_ANALYSES_PER_PERIOD) return { allowed: true, plan: "pro", inPeriod };
    // Quota mensuel épuisé : les crédits achetés prennent le relais. Ils sont
    // promis sans date d'expiration, ils doivent donc servir ici aussi.
    if ((credits?.balance ?? 0) > 0) return { allowed: true, plan: "pack" };
    return { allowed: false, reason: "no_credit", message: "Tu as atteint la limite de ton abonnement pour cette période." };
  }

  if (effectivePlan === "pack") {
    if ((credits?.balance ?? 0) > 0) return { allowed: true, plan: "pack" };
    return { allowed: false, reason: "no_credit", message: NO_PACK_CREDIT_MESSAGE };
  }

  // Plus aucun crédit : un compte qui a déjà payé ne repasse pas par la
  // gratuité, et le message dit ce qui s'est terminé.
  if (credits?.plan === "pro") {
    return { allowed: false, reason: "no_credit", message: "Ton abonnement n'est plus actif. Choisis une formule pour continuer." };
  }
  if (credits?.plan === "pack") {
    return { allowed: false, reason: "no_credit", message: NO_PACK_CREDIT_MESSAGE };
  }

  // Compte gratuit : l'analyse gratuite n'est disponible que si le compte n'en a
  // encore consommé aucune, y compris celle faite anonymement puis rattachée,
  // et y compris une analyse supprimée depuis (compteur durable).
  if (await freeAlreadyUsed({ kind: "user", id: user.id })) {
    return { allowed: false, reason: "no_credit", message: NO_CREDIT_MESSAGE };
  }
  return { allowed: true, plan: "free" };
}

export async function reserveAnalysis({ user, anonToken, commitAnonToken, ip }: Context): Promise<Grant | Denial> {
  const decision = await decideRight(user, anonToken);
  if (!decision.allowed) return decision;
  if (decision.plan === "pack") return grantPack((user as SessionUser).id);
  if (decision.plan === "pro") {
    const { inPeriod } = decision;
    // Le quota se compte sur les analyses enregistrées : celle-ci compte dès
    // qu'elle existe. Le commit vérifie seulement qu'elle ne dépasse pas.
    return {
      allowed: true,
      plan: "pro",
      commit: async () => (await inPeriod()) <= PRO_ANALYSES_PER_PERIOD,
      release: nothingToRelease,
    };
  }
  if (user) return grantFree(ip, { kind: "user", id: user.id });
  const token = commitAnonToken ?? anonToken;
  if (!token) throw new Error("Jeton anonyme absent pour le décompte de la gratuité");
  return grantFree(ip, { kind: "anon", token });
}

// Lecture seule, pour l'affichage : ne réserve rien, ne touche à aucun
// compteur (ni gratuité, ni filet anti-script par IP). Le droit réel reste
// décidé par reserveAnalysis au moment de l'analyse.
export async function analysisRightStatus(
  user: SessionUser | null,
  anonToken: string | null,
): Promise<{ allowed: true } | Omit<Denial, "allowed"> & { allowed: false }> {
  const decision = await decideRight(user, anonToken);
  return decision.allowed ? { allowed: true } : decision;
}

// ─── Tours de négociation (mission #080, D) ──────────────────────────────────

// D3 — le suivi de l'échange est réservé aux formules payantes. Dit simplement :
// c'est ce que la formule apporte, pas une faute de la personne.
export const TURN_PLAN_REQUIRED_MESSAGE =
  "Le suivi de l'échange avec la marque est compris dans le Pack Deal et l'abonnement Pro : chaque réponse analysée compte pour une analyse.";

// D1, D4 — un tour se réserve et se décompte exactement comme une analyse :
// vérifié avant l'appel au modèle, décompté après l'enregistrement du tour.
// Seule différence : un compte gratuit n'a pas de tour suivant.
export async function reserveTurn(user: SessionUser): Promise<Grant | Denial> {
  const decision = await decideRight(user, null);
  if (!decision.allowed) return decision;
  if (decision.plan === "free") return { allowed: false, reason: "plan_required", message: TURN_PLAN_REQUIRED_MESSAGE };
  if (decision.plan === "pack") return grantPack(user.id);
  const { inPeriod } = decision;
  return {
    allowed: true,
    plan: "pro",
    commit: async () => (await inPeriod()) <= PRO_ANALYSES_PER_PERIOD,
    release: nothingToRelease,
  };
}

// Ce que coûtera le prochain tour, pour le dire AVANT l'envoi (D1). Lecture
// seule : ne réserve rien.
export type TurnRight =
  | { kind: "signed_out" }
  | { kind: "plan_required"; message: string }
  | { kind: "no_credit"; message: string }
  | { kind: "pack"; balance: number }
  | { kind: "pro"; remaining: number };

export async function turnRightStatus(user: SessionUser | null): Promise<TurnRight> {
  if (!user) return { kind: "signed_out" };
  const decision = await decideRight(user, null);
  if (!decision.allowed) {
    const [credits] = await selectRows<{ plan: string }>("credits", `select=plan&user_id=eq.${user.id}&limit=1`);
    // Jamais payé : c'est la formule qui manque, pas un crédit.
    return credits?.plan === "pack" || credits?.plan === "pro"
      ? { kind: "no_credit", message: decision.message }
      : { kind: "plan_required", message: TURN_PLAN_REQUIRED_MESSAGE };
  }
  if (decision.plan === "free") return { kind: "plan_required", message: TURN_PLAN_REQUIRED_MESSAGE };
  if (decision.plan === "pro") return { kind: "pro", remaining: Math.max(0, PRO_ANALYSES_PER_PERIOD - (await decision.inPeriod())) };
  const [credits] = await selectRows<{ balance: number }>("credits", `select=balance&user_id=eq.${user.id}&limit=1`);
  return { kind: "pack", balance: credits?.balance ?? 0 };
}
