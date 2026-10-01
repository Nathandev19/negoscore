import { isUuid } from "@/lib/security/request";
import { rpc, selectRows } from "@/lib/supabase/server";
import { TIER_LABEL, type Tier } from "@/lib/rates/tier";
import type { Series } from "@/lib/admin/series";

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_PERIODS = ["24h", "7d", "30d", "all"] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];

export function parsePeriod(value: unknown): AdminPeriod {
  return (ADMIN_PERIODS as readonly unknown[]).includes(value) ? (value as AdminPeriod) : "7d";
}

export function sinceForPeriod(period: AdminPeriod, now = new Date()): string | null {
  const hours = period === "24h" ? 24 : period === "7d" ? 7 * 24 : period === "30d" ? 30 * 24 : null;
  return hours === null ? null : new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export type DashboardData = {
  counts: Record<string, number>;
  // Mission #103 — lignes de product_events écartées sur la période parce
  // qu'elles ne viennent pas de la production (local, prévisualisation, tests,
  // ou historique d'avant la mission). Affiché : c'est la preuve visible que
  // le filtre travaille.
  excluded: number;
  // Mission #118 — lignes DE PRODUCTION écartées parce qu'elles viennent du
  // propriétaire : ses comptes de test, son téléphone, son PC. Compteur
  // distinct de `excluded`, avec lequel il ne se recouvre jamais : une ligne
  // hors production n'est pas comptée ici, et réciproquement.
  internal: number;
  paid_pro: number;
  granted_pro: number;
  feedback: { total: number; fair: number; not_fair: number };
  purchases: { purchases: number; revenue_eur: number; revenue_covered: number };
  timeseries: Array<{ day: string; page_views: number; analyses: number; signups: number; purchases: number }>;
  acquisition: Array<{ source: string; campaign: string; content: string; visits: number; analyses: number; signups: number; purchases: number }>;
  // Mission #120 — ce que les pages d'arrivée depuis un moteur de recherche
  // produisent vraiment : une ligne par guide, ses vues, et combien de ses
  // lecteurs sont allés voir l'exemple chiffré.
  guides: Array<{ path: string; views: number; to_example: number }>;
  // Vues de /analyse/demo, et la part arrivée sans passer par un lien du site.
  example: { total: number; direct: number };
  // Mission #130 — les niveaux consultés depuis une page de résultat, et
  // combien de fois chacun. Le niveau enregistré sur une analyse, lui, reste
  // celui du calcul : c'est la colonne « Niveau initial » de /admin/analyses.
  tier_changes: Array<{ tier: string; changes: number }>;
};

const EMPTY_DASHBOARD: DashboardData = {
  counts: {}, excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
  feedback: { total: 0, fair: 0, not_fair: 0 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [], acquisition: [], guides: [], example: { total: 0, direct: 0 }, tier_changes: [],
};

export async function loadDashboard(period: AdminPeriod): Promise<DashboardData | "missing"> {
  try {
    const data = await rpc<DashboardData>("admin_dashboard_metrics", { p_since: sinceForPeriod(period) });
    // Migration #103 pas encore appliquée : la RPC ne renvoie pas encore le
    // compteur d'exclusions. Zéro plutôt qu'un affichage cassé.
    // Migration #120 pas encore appliquée : la RPC ne renvoie ni `guides` ni
    // `example`. Un tableau vide et deux zéros, plutôt qu'un affichage cassé.
    return data
      ? {
          ...EMPTY_DASHBOARD, ...data,
          excluded: data.excluded ?? 0, internal: data.internal ?? 0,
          guides: data.guides ?? [], example: data.example ?? EMPTY_DASHBOARD.example,
          tier_changes: data.tier_changes ?? [],
        }
      : EMPTY_DASHBOARD;
  } catch {
    return "missing";
  }
}

// Mission #103 — les tuiles du cockpit, décidées ici pour être vérifiables.
//
// Deux règles y sont tenues :
//   - aucun ratio affiché ne peut dépasser 100 % : un taux ne sort d'ici que
//     si son numérateur fait partie de son dénominateur (fair ⊆ total). Le
//     « Taux visite → analyse » divisait des événements par d'autres
//     événements : il affichait 505 %, il est supprimé, et rien ne le remplace
//     tant qu'on ne peut pas relier une analyse lancée à sa complétion ;
//   - un dénominateur nul n'affiche jamais 0 % ni NaN, mais « — ».
// Mission #132 — une tuile peut porter sa SÉRIE et une précision.
//   series : la pastille de couleur, jamais seule — elle accompagne un nom.
//            Les quatre tuiles qui en ont une sont celles des graphiques.
//   hint   : la ligne sous le chiffre. Elle dit d'où vient le nombre ou ce
//            qu'il recouvre, pour qu'un zéro se lise comme un zéro.
// Les libellés et les valeurs ne changent pas : c'est un travail
// d'affichage, et un test compare les valeurs rendues avant et après.
export type DashboardTile = { label: string; value: string; series?: Series; hint?: string };

// Mission #127 — CE QUI COMPTE COMME UNE VISITE.
//
// Constat du 01/10 : un clic réel sur /exemple depuis le navigateur intégré
// d'Instagram n'apparaissait nulle part. L'événement était bien écrit — le
// serveur l'insère sans erreur — mais le cockpit ne comptait comme « visite »
// que `landing_view` et `pricing_view`. Une arrivée sur la page d'exemple ou
// sur un guide valait donc zéro visite, et sa ligne d'acquisition affichait
// 0 partout : invisible dans la tuile, invisible dans la courbe, invisible
// dans le tableau par source.
//
// Une visite est une visite. Les quatre pages d'arrivée du produit comptent
// ici, et la même liste est reprise par la RPC (migration 20261001000034) :
// elles ne peuvent pas diverger sans qu'un test échoue.
export const VISIT_EVENTS = ["landing_view", "pricing_view", "guide_view", "example_view"] as const;

// Mission #129 — ET UNE SEULE FONCTION POUR LES COMPTER.
//
// La tuile appliquait VISIT_EVENTS ; le funnel agrégé, lui, additionnait
// encore `landing_view + pricing_view` dans son propre composant. Deux
// nombres portant le même nom, « Visites », à deux endroits du même écran :
// 100 dans la tuile, 84 dans le funnel, et rien pour dire lequel était le
// bon. L'écart valait exactement les vues de guides et d'exemple.
//
// Le mot « visite » n'a donc plus qu'une définition, et un seul endroit où
// elle se calcule. Les deux affichages appellent celui-là.
export function visitCount(data: DashboardData): number {
  return VISIT_EVENTS.reduce((sum, event) => sum + (data.counts[event] ?? 0), 0);
}

const NUMBER = new Intl.NumberFormat("fr-FR");
const count = (value: number | undefined) => NUMBER.format(value ?? 0);

// Part d'un tout, en pourcentage. null quand le tout est vide, ou quand la
// part n'est pas incluse dans le tout — auquel cas ce n'est pas un taux.
export function share(part: number, total: number): string | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  if (part < 0 || part > total) return null;
  return `${Math.round((part / total) * 100)} %`;
}

export function dashboardTiles(data: DashboardData): DashboardTile[] {
  const visits = visitCount(data);
  const revenue = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(data.purchases.revenue_eur);
  const completed = data.counts.analysis_completed ?? 0;
  return [
    { label: "Visites mesurées", value: count(visits), series: "visites", hint: "accueil · tarifs · guides · exemple" },
    // Deux compteurs bruts, côte à côte, sans ratio entre eux : voir plus haut.
    { label: "Analyses lancées", value: count(data.counts.analysis_started), series: "analyses", hint: `${count(completed)} terminée${completed > 1 ? "s" : ""}` },
    { label: "Analyses terminées", value: count(data.counts.analysis_completed) },
    { label: "Inscriptions", value: count(data.counts.signup), series: "inscriptions", hint: (data.counts.signup ?? 0) === 0 ? "le mur d'email n'a jamais été franchi" : "comptes créés sur la période" },
    { label: "Feedbacks", value: count(data.feedback.total) },
    { label: "Estimations jugées justes", value: share(data.feedback.fair, data.feedback.total) ?? "—" },
    { label: "Achats", value: count(data.purchases.purchases), series: "achats", hint: revenue },
    { label: `Revenu EUR couvert (${data.purchases.revenue_covered}/${data.purchases.purchases})`, value: revenue },
    { label: "Pro payants", value: count(data.paid_pro) },
    { label: "Pro offerts", value: count(data.granted_pro) },
  ];
}

// La preuve visible que le filtre travaille, en une ligne.
export function excludedNotice(data: DashboardData): string {
  return `Production uniquement. ${count(data.excluded)} événement(s) hors production exclus sur la période (local, prévisualisation, tests, historique).`;
}

// Mission #118 — la même preuve, pour le trafic du propriétaire. Une seconde
// ligne plutôt qu'un ajout à la première : « hors production » et « interne »
// ne disent pas la même chose, et mélanger leurs nombres rendrait les deux
// illisibles.
export function internalNotice(data: DashboardData): string {
  return `Dont ${count(data.internal)} événement(s) de production produits par un compte ou un appareil interne, exclus eux aussi.`;
}

// Mission #120 — la ligne sous le tableau des guides. Elle dit le total des
// vues de l'exemple chiffré et ce qui n'est venu d'aucun lien du site : la
// somme de la colonne « vers l'exemple » ne vaut donc jamais le total, et il
// faut le dire plutôt que de laisser croire à une soustraction ratée.
export function exampleNotice(data: DashboardData): string {
  const attributed = data.guides.reduce((sum, row) => sum + row.to_example, 0);
  return `Exemple chiffré : ${count(data.example.total)} vue(s) au total, dont ${count(attributed)} depuis un lien du site et ${count(data.example.direct)} en arrivée directe (moteur de recherche, lien partagé).`;
}

// Mission #130 — ce que le cockpit dit du changement de niveau.
//
// Constat du 01/10 : les huit analyses enregistrées affichaient toutes
// « starter ». C'est exact et ce n'est pas un défaut : le niveau d'une
// analyse est celui avec lequel elle a été CALCULÉE, et changer de niveau
// sur la page de résultat recalcule tout dans le navigateur sans rien
// écrire. Ce que personne ne pouvait savoir, c'est si quelqu'un avait
// seulement essayé. Cette ligne-là répond.
export function tierChangesNotice(data: DashboardData): string {
  const total = data.tier_changes.reduce((sum, row) => sum + row.changes, 0);
  if (total === 0) return `Aucun changement de niveau sur la période. Le niveau d'une analyse reste celui de son calcul.`;
  const detail = data.tier_changes
    .map((row) => `${TIER_LABEL[row.tier as Tier]?.short ?? row.tier} : ${count(row.changes)}`)
    .join(" · ");
  return `${count(total)} changement(s) de niveau sur la période — ${detail}. Le niveau enregistré sur l'analyse, lui, reste celui de son calcul.`;
}

// Mission #112, A4 — les paiements que le produit n'a pas su rattacher à un
// compte doivent être VISIBLES, pas seulement journalisés : un journal ne se
// regarde pas, un cockpit si. Deux états y figurent :
//   - encore en attente : le rattrapage réessaie pendant 30 jours ;
//   - abandonnés : au-delà, on a cessé d'espérer. C'est de l'argent encaissé
//     dont personne n'a eu la contrepartie, et c'est à traiter à la main.
// Depuis la mission #112, ce tableau ne devrait plus jamais se remplir : le
// paiement n'ouvre pas quand la session ne porte pas l'identifiant du compte.
export type UnattachedPayment = {
  event_id: string;
  email: string | null;
  plan: "pack" | "pro";
  amount: number | null;
  currency: string | null;
  paid_at: string;
  resolution: string | null;
};

export async function loadUnattachedPayments(limit = 25): Promise<UnattachedPayment[] | "missing"> {
  try {
    return await selectRows<UnattachedPayment>(
      "pending_payments",
      `select=event_id,email,plan,amount,currency,paid_at,resolution&reason=eq.compte_introuvable&order=paid_at.desc&limit=${limit}`,
    );
  } catch {
    return "missing";
  }
}

export type AdminUserRow = {
  id: string; email: string | null; created_at: string; balance: number;
  plan: "free" | "pack" | "pro" | null; period_end: string | null;
  admin_grant: boolean; analyses: number; last_activity: string;
};
export type AdminUsersPage = { total: number; items: AdminUserRow[] };

export async function loadAdminUsers(input: { search?: string; page?: number; sort?: string }): Promise<AdminUsersPage | "missing"> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const sort = ["recent", "email", "analyses", "activity"].includes(input.sort ?? "") ? input.sort : "recent";
  try {
    return await rpc<AdminUsersPage>("admin_users_page", {
      p_search: (input.search ?? "").slice(0, 120), p_offset: (page - 1) * ADMIN_PAGE_SIZE, p_limit: ADMIN_PAGE_SIZE, p_sort: sort,
    });
  } catch {
    return "missing";
  }
}

export type AdminAnalysisRow = {
  id: string; created_at: string; user_id: string | null; email: string | null; score: number | null;
  offered_amount: string | null; estimate_low: string | null; estimate_high: string | null;
  profile_tier: string | null; feedback: string | null; turns: number; concluded: boolean;
};
export type AdminAnalysesPage = { total: number; items: AdminAnalysisRow[] };

export async function loadAdminAnalyses(page = 1): Promise<AdminAnalysesPage | "missing"> {
  try {
    return await rpc<AdminAnalysesPage>("admin_analyses_page", { p_offset: (Math.max(1, page) - 1) * ADMIN_PAGE_SIZE, p_limit: ADMIN_PAGE_SIZE });
  } catch {
    return "missing";
  }
}

export async function loadAdminUserDetail(id: string) {
  if (!isUuid(id)) return null;
  const [profileRows, creditRows, grants, ledger, deals, turns, feedback, events, audit] = await Promise.all([
    selectRows<{ id: string; email: string | null; created_at: string }>("profiles", `select=id,email,created_at&id=eq.${id}&limit=1`),
    selectRows<{ balance: number; plan: string; period_end: string | null; cancelled_at: string | null }>("credits", `select=balance,plan,period_end,cancelled_at&user_id=eq.${id}&limit=1`),
    selectRows<{ id: string; active: boolean; granted_at: string; expires_at: string | null; reason: string | null; revoked_at: string | null }>("admin_entitlements", `select=id,active,granted_at,expires_at,reason,revoked_at&user_id=eq.${id}&order=granted_at.desc&limit=20`).catch(() => []),
    selectRows<{ id: string; delta: number; balance_before: number; balance_after: number; reason: string; occurred_at: string }>("credit_ledger", `select=id,delta,balance_before,balance_after,reason,occurred_at&user_id=eq.${id}&order=occurred_at.desc&limit=50`).catch(() => []),
    selectRows<{ id: string; created_at: string; status: string; analyses: Array<{ id: string; score: number | null }> }>("deals", `select=id,created_at,status,analyses(id,score)&user_id=eq.${id}&order=created_at.desc&limit=50`),
    selectRows<{ id: string; analysis_id: string; kind: "reply" | "conclusion"; turn_number: number | null; created_at: string }>("negotiation_turns", `select=id,analysis_id,kind,turn_number,created_at&user_id=eq.${id}&order=created_at.desc&limit=50`).catch(() => []),
    selectRows<{ analysis_id: string; rating: string; updated_at: string }>("analysis_feedback", `select=analysis_id,rating,updated_at&analysis:analyses!inner(deal:deals!inner(user_id))&analysis.deal.user_id=eq.${id}&order=updated_at.desc&limit=50`).catch(() => []),
    selectRows<{ id: string; event_name: string; occurred_at: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null }>("product_events", `select=id,event_name,occurred_at,utm_source,utm_medium,utm_campaign,utm_content&user_id=eq.${id}&order=occurred_at.desc&limit=50`).catch(() => []),
    selectRows<{ id: string; action: string; reason: string | null; occurred_at: string }>("admin_audit_log", `select=id,action,reason,occurred_at&target_type=eq.user&target_id=eq.${id}&order=occurred_at.desc&limit=50`).catch(() => []),
  ]);
  const profile = profileRows[0];
  if (!profile) return null;
  const now = Date.now();
  const activeGrant = grants.find((grant) => grant.active && (!grant.expires_at || new Date(grant.expires_at).getTime() > now)) ?? null;
  const credits = creditRows[0] ?? null;
  const paid = Boolean(credits?.plan === "pro" && credits.period_end && new Date(credits.period_end).getTime() > now);
  const activityDates = [profile.created_at, ...deals.map((deal) => deal.created_at), ...events.map((event) => event.occurred_at)];
  const lastActivity = activityDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return { profile, credits, grants, activeGrant, paid, ledger, deals, turns, feedback, events, audit, lastActivity };
}
