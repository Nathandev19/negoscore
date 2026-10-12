import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountView } from "@/components/account/account-view";
import { accountSummary } from "@/lib/account/summary";
import { getViewer } from "@/lib/auth/viewer";
import { analysisBalanceFrom, accountFreeAnalysisUsedFrom, accountFreeUsage } from "@/lib/billing/entitlement";
import type { PlanState } from "@/lib/billing/plan-access";
import { selectRows } from "@/lib/supabase/server";
import { activeAdminGrant } from "@/lib/billing/access";

export const metadata: Metadata = {
  title: "Mon compte",
  robots: { index: false, follow: false },
};

// Le compte est une adresse email : son état, ses liens, sa fin.
// Un visiteur sans session est redirigé par proxy.ts avant tout rendu ; la
// vérification reste ici par sécurité.
export default async function AccountPage() {
  const user = await getViewer();
  if (!user) redirect(`/connexion?next=${encodeURIComponent("/compte")}`);

  // Mission #107 — les trois lectures partent ENSEMBLE. Le compteur de gratuité
  // ne dépendait pas du solde : seule son INTERPRÉTATION en dépend (la ligne
  // n'est montrée que pour un compte gratuit). La chaîne passe de trois
  // allers-retours à un, et le repli sur les analyses déjà faites ne part que
  // lorsque le compteur ne tranche pas — donc jamais pour un compte payant.
  // Mission #182 — LE SOLDE VIENT DE LA MÊME FONCTION QUE PARTOUT AILLEURS.
  //
  // Cette page affichait « Négociations restantes : credits.balance » — la
  // réserve ACHETÉE, pas ce qu'il reste. Un abonné Pro avec 30 négociations
  // devant lui y lisait 0, et la ligne « Négociation gratuite » de la #067
  // était là pour rattraper le même trou côté gratuit. Un seul chiffre
  // maintenant, celui de lib/billing/entitlement.ts, le même que l'en-tête.
  //
  const [[credits], adminGrant, freeCounter] = await Promise.all([
    selectRows<PlanState>("credits", `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`),
    activeAdminGrant(user.id),
    // Lecture impossible : la ligne n'est pas affichée plutôt que de deviner.
    accountFreeUsage(user.id).catch(() => "missing" as const),
  ]);

  // Le solde part des valeurs ci-dessus : aucune relecture de credits ni du
  // compteur de gratuité. Seul un abonnement demande une lecture de plus — son
  // quota n'existe nulle part ailleurs que dans les analyses de la période.
  // Illisible : aucun nombre, jamais un zéro inventé.
  const solde = await analysisBalanceFrom(user, credits ?? null, adminGrant, freeCounter).catch(() => null);

  const summary = accountSummary(credits ?? null, new Date(), adminGrant);
  // Compte gratuit : « Crédits d'analyse : 0 » ne dit pas si l'analyse gratuite
  // reste disponible (mission #067).
  const freeAnalysis =
    summary.plan === "free"
      ? await accountFreeAnalysisUsedFrom(user.id, freeCounter).then(
          (used) => (used ? ("used" as const) : ("available" as const)),
          () => null,
        )
      : null;

  return <AccountView data={{ email: user.email, summary, freeAnalysis, restantes: solde ? solde.restantes : "illisible" }} />;
}
