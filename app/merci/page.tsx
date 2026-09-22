import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThanksView } from "@/components/account/thanks-view";
import { getViewer } from "@/lib/auth/viewer";
import { recentPurchases } from "@/lib/billing/purchases";
import { selectRows } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Merci",
  robots: { index: false, follow: false },
};

type Credits = { plan: "free" | "pack" | "pro"; balance: number; period_end: string | null };

export default async function ThanksPage() {
  const user = await getViewer();
  if (!user) redirect(`/connexion?next=${encodeURIComponent("/merci")}`);

  const [credits] = await selectRows<Credits>(
    "credits",
    `select=plan,balance,period_end&user_id=eq.${user.id}&limit=1`,
  );
  // Mission #090 : ce qui vient d'être acheté, écrit par le webhook. Le webhook
  // peut arriver après cette page : « purchase: null » veut dire « pas encore
  // enregistré », et la page attend au lieu d'affirmer quoi que ce soit.
  const purchases = await recentPurchases(user.id).catch(() => "unavailable" as const);

  return (
    <ThanksView
      credits={credits ?? null}
      bought={
        purchases === "unavailable"
          ? "unknown"
          : { purchase: purchases.last, duplicates: purchases.duplicates, analysesAdded: purchases.analysesAdded }
      }
    />
  );
}
