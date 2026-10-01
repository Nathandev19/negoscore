import type { Metadata } from "next";
import { Cockpit } from "@/components/admin/cockpit";
import { ADMIN_PERIODS, loadDashboards, loadUnattachedPayments, parsePeriod } from "@/lib/admin/data";
import { dateHeureParis, MENTION_FUSEAU } from "@/lib/admin/heure";
import type { CockpitCaches } from "@/components/admin/cockpit";

export const metadata: Metadata = { title: "Cockpit", robots: { index: false, follow: false } };

// Mission #132 — la page sert le PREMIER rendu, complet, depuis le serveur :
// les chiffres sont là avant tout JavaScript, et l'adresse ?period= reste la
// source de vérité au chargement. Le changement de période, lui, ne recharge
// plus rien (components/admin/cockpit.tsx) : les graphiques restent montés et
// seules leurs valeurs changent.
//
// Mission #133 — et il embarque les QUATRE périodes, pas seulement celle de
// l'adresse. Mesuré (app/dev/mesure-cockpit/route.dev.ts) : quatre RPC
// lancées ensemble coûtent 154 ms contre 110 ms pour une seule — 45 ms de
// plus sur le premier rendu — et pèsent 6,4 ko. En échange, changer de
// période ne traverse plus le réseau du tout.
//
// Les paiements non rattachés restent rendus ici : ils ne dépendent pas de la
// période, et les recharger à chaque clic n'apprendrait rien.
export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  const params = await searchParams;
  const period = parsePeriod(params.period);
  const [parPeriode, unattached] = await Promise.all([loadDashboards(), loadUnattachedPayments()]);
  // Une période dont la RPC a échoué n'entre pas en mémoire : le cockpit dira
  // qu'elle manque plutôt que d'afficher les chiffres d'une autre.
  const caches: CockpitCaches = Object.fromEntries(
    ADMIN_PERIODS.filter((p) => parPeriode[p] !== "missing").map((p) => [p, parPeriode[p]]),
  );
  return (
    <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 md:py-14">
      {parPeriode[period] === "missing" ? (
        <p role="alert" className="alert-bad">
          Le cockpit attend la migration admin 20260923000030.
        </p>
      ) : (
        <Cockpit initial={caches} period={period} />
      )}
      {/* Mission #112, A4 — un paiement qu'on n'a pas su rattacher se voit ici,
          pas seulement dans les journaux. Le bloc n'apparaît que s'il y en a. */}
      {unattached !== "missing" && unattached.length > 0 ? (
        <section aria-label="Paiements non rattachés" className="border-t-4 border-encre pt-4">
          <h2 className="text-h2 mb-2">Paiements sans compte rattaché</h2>
          <p className="mb-4 text-small text-attenue">
            De l&apos;argent encaissé dont personne n&apos;a reçu la contrepartie. À rattacher à la main, puis à
            re-signaler à Whop si besoin.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-small">
              <thead>
                <tr className="border-b">
                  <th className="py-2">Payé le ({MENTION_FUSEAU})</th>
                  <th>Formule</th>
                  <th>Montant</th>
                  <th>Adresse de paiement</th>
                  <th>État</th>
                  <th>Événement</th>
                </tr>
              </thead>
              <tbody>
                {unattached.map((row) => (
                  <tr key={row.event_id} className="border-b">
                    <td className="py-3">{dateHeureParis(row.paid_at)}</td>
                    <td>{row.plan}</td>
                    <td className="tabular-nums">{row.amount === null ? "—" : `${row.amount} ${row.currency ?? ""}`}</td>
                    <td>{row.email ?? "—"}</td>
                    <td>
                      {row.resolution === "abandonne" ? "Abandonné" : row.resolution === "rattache" ? "Rattaché" : "En attente"}
                    </td>
                    <td className="font-mono text-xs">{row.event_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
