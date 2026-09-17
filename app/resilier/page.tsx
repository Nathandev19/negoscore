import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CancelView } from "@/components/account/cancel-view";
import { getViewer } from "@/lib/auth/viewer";
import type { PlanState } from "@/lib/billing/plan-access";
import { SELLER } from "@/lib/legal/identity";
import { selectRows } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Résilier votre contrat",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  introuvable: `On n'a pas retrouvé ton abonnement chez le prestataire de paiement. Écris-nous à ${SELLER.email}, on s'en occupe.`,
  whop: `La résiliation n'a pas pu être enregistrée. Réessaie dans quelques minutes, ou écris-nous à ${SELLER.email}.`,
  indisponible: `Le service de résiliation n'est pas disponible pour le moment. Réessaie plus tard, ou écris-nous à ${SELLER.email}.`,
};

export default async function CancelPage({ searchParams }: PageProps<"/resilier">) {
  const user = await getViewer();
  if (!user) redirect(`/connexion?next=${encodeURIComponent("/resilier")}`);

  const params = await searchParams;
  const error = typeof params.erreur === "string" ? ERRORS[params.erreur] : null;

  const [credits] = await selectRows<PlanState>(
    "credits",
    `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
  );

  return (
    <CancelView
      data={{
        credits: credits ?? null,
        error,
        forDeletion: params.motif === "suppression",
        etat: typeof params.etat === "string" ? params.etat : null,
      }}
    />
  );
}
