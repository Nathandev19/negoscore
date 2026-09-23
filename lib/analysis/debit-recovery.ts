import {
  claimDebit,
  countAttempt,
  openDebits,
  removeUndebitedAnalysis,
  type PendingDebit,
} from "@/lib/analysis/pending-debit";
import { consumeFree } from "@/lib/billing/free-usage";
import { FREE_ANALYSES } from "@/lib/billing/plans";
import { adjustInteger } from "@/lib/supabase/server";

// Mission #099, point 1 (audit A1) — le rattrapage quotidien des analyses
// enregistrées sans décompte.
//
// Deux issues, jamais d'entre-deux :
//   - le droit existe encore : il est débité, l'analyse reste ;
//   - il n'existe pas : l'analyse est supprimée, et c'est dit.
// Dans les deux cas la ligne est réglée, et aucune analyse ne reste visible
// sans contrepartie au-delà du passage suivant du cron (DEBIT_GRACE_HOURS).

export type DebitRecoveryReport = { decomptes: number; supprimees: number; echecs: number };

// Le décompte, exactement celui de lib/billing/entitlement.ts : une unité de
// solde pour un compte, la gratuité du jeton sinon. « retry » ne débite rien
// par construction (relance gratuite) : la ligne est réglée sans toucher au
// solde.
async function debit(pending: PendingDebit): Promise<boolean> {
  if (pending.plan === "retry") return true;
  if (pending.user_id !== null && (pending.plan === "pack" || pending.plan === "pro")) {
    return (await adjustInteger("credits", `user_id=eq.${pending.user_id}`, "balance", -1, (balance) => balance > 0)) !== null;
  }
  const subject = pending.user_id !== null ? ({ kind: "user", id: pending.user_id } as const) : pending.anon_token !== null ? ({ kind: "anon", token: pending.anon_token } as const) : null;
  if (subject === null) return false;
  const consumed = await consumeFree(subject, FREE_ANALYSES);
  // Table free_usage absente : on ne sait pas décompter, on ne supprime pas
  // une analyse sur une incertitude — la ligne reste ouverte pour demain.
  return consumed === "missing" ? true : consumed;
}

export async function recoverPendingDebits(): Promise<DebitRecoveryReport> {
  const report: DebitRecoveryReport = { decomptes: 0, supprimees: 0, echecs: 0 };
  for (const pending of await openDebits()) {
    try {
      await countAttempt(pending.analysis_id, pending.attempts);
      if (await debit(pending)) {
        if (await claimDebit(pending.analysis_id, "decompte")) report.decomptes += 1;
        continue;
      }
      // Plus aucun droit derrière cette analyse : elle ne peut pas rester
      // visible. La ligne est réglée AVANT la suppression : c'est la base qui
      // désigne qui supprime, et un second passage ne la refait pas.
      if (!(await claimDebit(pending.analysis_id, "supprimee"))) continue;
      await removeUndebitedAnalysis(pending);
      report.supprimees += 1;
      console.warn(
        JSON.stringify({
          event: "analyse_supprimee_faute_de_decompte",
          analysis_id: pending.analysis_id,
          user_id: pending.user_id,
          plan: pending.plan,
          attempts: pending.attempts + 1,
        }),
      );
    } catch (caught) {
      report.echecs += 1;
      console.error(
        JSON.stringify({
          event: "analyse_decompte_rattrapage_error",
          analysis_id: pending.analysis_id,
          detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
        }),
      );
    }
  }
  return report;
}
