import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreditsWaiter } from "@/components/merci/credits-waiter";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getViewer } from "@/lib/auth/viewer";
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

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <h1 className="text-h1 font-extrabold">Merci !</h1>
        <CreditsWaiter initial={credits ?? null} />
      </main>
      <SiteFooter />
    </>
  );
}
