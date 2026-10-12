import type { SessionUser } from "@/lib/auth/session";
import { consumeFree, freeUsed, type FreeSubject } from "@/lib/billing/free-usage";
import { displayedPlan, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { FREE_ANALYSES, PRO_ANALYSES_PER_PERIOD } from "@/lib/billing/plans";
import { NO_FREE_LEFT_MESSAGE } from "@/lib/billing/right-hint";
import { hashIp } from "@/lib/security/request";
import { hitUsageGuard, releaseUsageGuard } from "@/lib/security/usage-guard";
import { adjustInteger, countRows, isMissingColumn, selectRows } from "@/lib/supabase/server";
import { activeAdminGrant, grantPeriod, type AdminGrant } from "@/lib/billing/access";

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
  reason: "free_used" | "no_credit" | "rate_limited";
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
const NO_PACK_CREDIT_MESSAGE = "Tu n'as plus de négociation disponible. Choisis une formule pour continuer.";
const RATE_LIMITED_MESSAGE =
  "Trop de négociations ont été lancées depuis ton réseau ces dernières heures. Réessaie plus tard, ou connecte-toi pour continuer.";

const nothingToRelease = async () => undefined;

// Analyses du compte sur la période, relances gratuites exclues (is_retry,
// migration 018) : une relance d'analyse incomplète ne consomme pas le quota.
// Sans la migration, la colonne n'existe pas et aucune relance n'a pu être
// enregistrée : on compte toutes les analyses, comme avant.
async function analysesInPeriod(userId: string, start: Date, end: Date): Promise<number> {
  const query = `select=id,deal:deals!inner(user_id)&deal.user_id=eq.${userId}&created_at=gt.${start.toISOString()}&created_at=lte.${end.toISOString()}`;
  try {
    // Lecture plutôt que comptage : une requête HEAD ne renvoie pas le code d'erreur
    // qui distingue une colonne absente. Le quota est petit, la lecture aussi.
    const rows = await selectRows<{ id: string }>("analyses", `${query}&is_retry=is.false&limit=${PRO_ANALYSES_PER_PERIOD + 1}`);
    return rows.length;
  } catch (caught) {
    if (!isMissingColumn(caught)) throw caught;
    return countRows("analyses", query);
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

// La règle, à partir d'un compteur DÉJÀ lu : gratuité prise si le compteur le
// dit ; sinon, et seulement sinon, on regarde les analyses déjà faites. Le
// second aller-retour ne part donc que lorsqu'il tranche quelque chose.
async function freeUsedFromCounter(subject: FreeSubject, used: number | "missing"): Promise<boolean> {
  if (used !== "missing" && used >= FREE_ANALYSES) return true;
  const owner = subject.kind === "anon" ? `anon_token=eq.${encodeURIComponent(subject.token)}` : `user_id=eq.${subject.id}`;
  const done = await selectRows<{ id: string }>("deals", `select=id&${owner}&status=eq.analysed&limit=${FREE_ANALYSES}`);
  return done.length >= FREE_ANALYSES;
}

async function freeAlreadyUsed(subject: FreeSubject): Promise<boolean> {
  return freeUsedFromCounter(subject, await freeUsed(subject));
}

// Mission #107 — le compteur seul, lisible EN MÊME TEMPS que le solde : il ne
// dépend que du compte. C'est son interprétation qui attend le solde, pas sa
// lecture.
export async function accountFreeUsage(userId: string): Promise<number | "missing"> {
  return freeUsed({ kind: "user", id: userId });
}

// Mission #183 — accountFreeAnalysisUsedFrom et accountFreeAnalysisUsed
// vivaient ici pour la ligne « Négociation gratuite » de /compte, retirée avec
// cette mission : le solde de la #182 répond à la même question, en un nombre.
// Sans appelant, elles n'étaient plus que du code que personne ne vérifie.
// freeUsedFromCounter, qui faisait leur travail, reste : le droit réel et le
// solde s'en servent tous les deux.

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

  const [[credits], adminGrant] = await Promise.all([
    selectRows<PlanState>("credits", `select=plan,balance,period_end&user_id=eq.${user.id}&limit=1`),
    activeAdminGrant(user.id),
  ]);

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

  if (adminGrant) {
    const { start, end } = grantPeriod(adminGrant);
    const inPeriod = () => analysesInPeriod(user.id, start, end);
    if ((await inPeriod()) < PRO_ANALYSES_PER_PERIOD) return { allowed: true, plan: "pro", inPeriod };
    if ((credits?.balance ?? 0) > 0) return { allowed: true, plan: "pack" };
    return { allowed: false, reason: "no_credit", message: "Tu as atteint la limite de ton accès Pro offert pour cette période." };
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

// ══════════════════════ COMBIEN IL EN RESTE ════════════════════════════════
//
// Mission #182 — un seul endroit répond, et c'est celui-ci.
//
// CE QUI N'ALLAIT PAS. Trois magasins différents portent le quota, selon la
// formule : le compteur durable free_usage pour la gratuité, credits.balance
// pour une réserve achetée, et le NOMBRE D'ANALYSES DE LA PÉRIODE pour un
// abonnement (analysesInPeriod, plus haut) — un Pro n'a pas de compteur
// stocké, son quota EST ce comptage. Et deux écrans prétendaient déjà dire ce
// qu'il reste sans se parler : /api/droits, qui applique la vraie règle, et
// « Négociations restantes » sur /compte, qui affichait credits.balance brut.
// Pour un abonné Pro avec 30 analyses devant lui, cette ligne affichait 0.
//
// La fonction ci-dessous ne recompte RIEN de son côté : elle appelle les mêmes
// lectures que decideRight, dans le même ordre de priorité. Et un test de
// concordance refuse qu'elle en diverge — restantes === 0 doit valoir
// exactement « le droit est refusé ».
export type AnalysisBalance = {
  // null : AUCUN PLAFOND. Aucun palier n'en produit aujourd'hui ; le mot
  // existe pour que le jour où l'un apparaît, l'affichage dise « illimité »
  // au lieu d'un nombre inventé ou d'un tiret.
  restantes: number | null;
  // Date à laquelle le quota se recharge, quand il se recharge. null : il ne
  // se recharge pas (gratuité, réserve achetée), et l'écran dit alors par où
  // en obtenir d'autres.
  rechargeLe: Date | null;
  source: "gratuit" | "pack" | "pro" | "pro_offert";
  // Mission #182 — RIEN N'A ENCORE ÉTÉ DÉPENSÉ sur ce stock.
  //
  // Mesuré à l'écran : une visiteuse qui arrive a une négociation, soit
  // exactement le seuil bas — elle lisait « c'est ta dernière » avant d'avoir
  // commencé. Un stock intact n'est pas un stock bas, et chez nous tout
  // dépend de cette première analyse.
  //
  // Renseigné pour la gratuité seulement : son stock est une constante
  // (FREE_ANALYSES), on sait donc le comparer. Une réserve achetée
  // s'additionne au fil des achats et son stock d'origine n'est stocké nulle
  // part : à une négociation de la fin, elle est bel et bien basse.
  intact: boolean;
};

// La gratuité restante, par le compteur durable. Table absente (migration 015
// pas appliquée) : on retombe sur la règle du moteur, pas sur une estimation.
async function freeRemaining(subject: FreeSubject): Promise<number> {
  const used = await freeUsed(subject);
  if (used !== "missing") return Math.max(0, FREE_ANALYSES - used);
  return (await freeUsedFromCounter(subject, used)) ? 0 : FREE_ANALYSES;
}

// La façade : pour les appelants qui n'ont encore rien lu (la route
// /api/solde, et un navigateur sans compte).
export async function analysisBalance(user: SessionUser | null, anonToken: string | null): Promise<AnalysisBalance> {
  // Sans compte : la gratuité de CE navigateur. Sans jeton, aucune analyse n'a
  // encore été lancée ici — la gratuité est entière.
  if (!user) {
    const restantes = anonToken ? await freeRemaining({ kind: "anon", token: anonToken }) : FREE_ANALYSES;
    return { restantes, rechargeLe: null, source: "gratuit", intact: restantes >= FREE_ANALYSES };
  }
  const [[credits], adminGrant, freeCounter] = await Promise.all([
    selectRows<PlanState>("credits", `select=plan,balance,period_end&user_id=eq.${user.id}&limit=1`),
    activeAdminGrant(user.id),
    accountFreeUsage(user.id).catch(() => "missing" as const),
  ]);
  return analysisBalanceFrom(user, credits ?? null, adminGrant, freeCounter);
}

// La règle, à partir de ce qui est DÉJÀ lu. Seul le quota d'un abonnement
// demande encore une lecture : il n'existe nulle part ailleurs que dans le
// nombre d'analyses de la période (analysesInPeriod, plus haut).
export async function analysisBalanceFrom(
  user: SessionUser,
  credits: PlanState | null,
  adminGrant: AdminGrant | null,
  freeCounter: number | "missing",
): Promise<AnalysisBalance> {
  const balance = credits?.balance ?? 0;

  // Abonnement en cours. Le quota du mois ET la réserve achetée s'additionnent,
  // parce que le moteur les additionne : quota épuisé, les crédits prennent le
  // relais (decideRight, plus haut). Le nombre affiché est donc bien « ce que
  // je peux lancer maintenant », et la date de recharge ne porte que sur le
  // quota — c'est ce que la phrase dit.
  if (displayedPlan(credits) === "pro") {
    const periodEnd = periodEndsAt(credits) as Date;
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);
    const used = await analysesInPeriod(user.id, periodStart, periodEnd);
    return {
      restantes: Math.max(0, PRO_ANALYSES_PER_PERIOD - used) + balance,
      rechargeLe: periodEnd,
      source: "pro",
      intact: false,
    };
  }

  // Accès Pro offert : même droit, mais la fenêtre est glissante (access.ts).
  // Il n'y a de date de recharge que si l'accès a une fin déclarée.
  if (adminGrant) {
    const { start, end } = grantPeriod(adminGrant);
    const used = await analysesInPeriod(user.id, start, end);
    return {
      restantes: Math.max(0, PRO_ANALYSES_PER_PERIOD - used) + balance,
      rechargeLe: adminGrant.expires_at ? new Date(adminGrant.expires_at) : null,
      source: "pro_offert",
      intact: false,
    };
  }

  if (balance > 0) return { restantes: balance, rechargeLe: null, source: "pack", intact: false };

  // Compte qui a DÉJÀ payé et n'a plus rien : il ne repasse pas par la
  // gratuité. La même règle que decideRight, écrite ici pour la même raison —
  // sinon l'écran annoncerait une analyse que le serveur refuserait.
  if (credits?.plan === "pro" || credits?.plan === "pack") {
    return { restantes: 0, rechargeLe: null, source: credits.plan === "pro" ? "pro" : "pack", intact: false };
  }

  const subject = { kind: "user", id: user.id } as const;
  const restantes =
    freeCounter !== "missing"
      ? Math.max(0, FREE_ANALYSES - freeCounter)
      : (await freeUsedFromCounter(subject, freeCounter))
        ? 0
        : FREE_ANALYSES;
  return { restantes, rechargeLe: null, source: "gratuit", intact: restantes >= FREE_ANALYSES };
}
