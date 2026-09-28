import type { Metadata } from "next";
import Link from "next/link";
import { Funnel, TimeSeries } from "@/components/admin/charts";
import { ADMIN_PERIODS, dashboardTiles, exampleNotice, excludedNotice, internalNotice, loadDashboard, loadUnattachedPayments, parsePeriod, share } from "@/lib/admin/data";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Cockpit", robots: { index: false, follow: false } };

const labels = { "24h": "24 h", "7d": "7 jours", "30d": "30 jours", all: "Tout" } as const;

export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  const params = await searchParams;
  const period = parsePeriod(params.period);
  const [data, unattached] = await Promise.all([loadDashboard(period), loadUnattachedPayments()]);
  // Mission #103 — les tuiles et leurs règles sont dans lib/admin/data.ts :
  // « Taux visite → analyse » y a disparu (il divisait des événements par des
  // événements et affichait 505 %), et aucun ratio affiché ne peut dépasser
  // 100 %.
  return <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 md:py-14">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-small font-semibold uppercase tracking-widest text-marque">Aujourd’hui et tendances</p><h1 className="text-h1">Cockpit {BRAND.name}</h1></div><div className="flex flex-wrap gap-2">{ADMIN_PERIODS.map((p)=><Link key={p} href={`/admin?period=${p}`} aria-current={p===period?"page":undefined} className={`rounded-pill border px-3 py-1 text-small font-semibold ${p===period?"bg-encre text-creme":"bg-creme text-encre"}`}>{labels[p]}</Link>)}</div></div>
    {data === "missing" ? <p role="alert" className="alert-bad">Le cockpit attend la migration admin 20260923000030.</p> : <>
      <section aria-label="Indicateurs" className="grid gap-px overflow-hidden border border-filet bg-filet sm:grid-cols-2 lg:grid-cols-4">
        {dashboardTiles(data).map((tile)=><div key={tile.label} className="bg-creme p-5"><p className="text-small text-attenue">{tile.label}</p><p className="figures mt-2 text-3xl text-encre">{tile.value}</p></div>)}
      </section>
      <section className="grid gap-8 lg:grid-cols-[1.35fr_1fr]"><div className="min-w-0 border-t-4 border-marque pt-4"><h2 className="text-h2 mb-5">Activité</h2><TimeSeries rows={data.timeseries} /></div><div className="border-t-4 border-encre pt-4"><h2 className="text-h2 mb-5">Funnel agrégé</h2><Funnel data={data} /></div></section>
      <section className="grid gap-8 lg:grid-cols-2"><div><h2 className="text-h2 mb-4">Acquisition</h2>{data.acquisition.length===0?<p className="text-attenue">Aucune attribution disponible.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-small"><thead><tr className="border-b"><th className="py-2">Source / campagne / contenu</th><th>Visites</th><th>Analyses</th><th>Achats</th></tr></thead><tbody>{data.acquisition.map((r)=><tr key={`${r.source}/${r.campaign}/${r.content}`} className="border-b"><td className="py-3"><strong>{r.source}</strong><br/><span className="text-attenue">{r.campaign} · {r.content}</span></td><td>{r.visits}</td><td>{r.analyses}</td><td>{r.purchases}</td></tr>)}</tbody></table></div>}</div>
      <div><h2 className="text-h2 mb-4">Feedback estimation</h2><div className="grid grid-cols-3 gap-px bg-filet border border-filet">{[["Total",data.feedback.total],["Juste",data.feedback.fair],["Pas juste",data.feedback.not_fair]].map(([label,value])=><div key={String(label)} className="bg-creme p-4"><p className="text-small text-attenue">{label}</p><p className="figures text-2xl">{value}</p></div>)}</div></div></section>
      {/* Mission #120 — les pages d'arrivée depuis un moteur de recherche.
          Le tableau ne s'affiche que s'il y a quelque chose à montrer : un
          tableau vide sur un cockpit vide n'apprend rien. */}
      {data.guides.length > 0 || data.example.total > 0 ? <section aria-label="Guides et exemple chiffré" className="border-t-4 border-marque pt-4">
        <h2 className="text-h2 mb-2">Guides et exemple chiffré</h2>
        <p className="text-small text-attenue mb-4">Pages d&apos;arrivée depuis un moteur de recherche. « Vers l&apos;exemple » compte les clics vers l&apos;analyse complète, attribués au guide d&apos;origine.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-small"><thead><tr className="border-b"><th className="py-2">Page</th><th>Vues</th><th>Vers l&apos;exemple</th><th>Part</th></tr></thead><tbody>
          {data.guides.map((row)=><tr key={row.path} className="border-b"><td className="py-3 font-mono text-xs">{row.path}</td><td className="tabular-nums">{row.views}</td><td className="tabular-nums">{row.to_example}</td><td className="tabular-nums">{share(row.to_example, row.views) ?? "—"}</td></tr>)}
        </tbody></table></div>
        <p className="text-small text-attenue mt-3">{exampleNotice(data)}</p>
      </section> : null}
      {/* Mission #112, A4 — un paiement qu'on n'a pas su rattacher se voit ici,
          pas seulement dans les journaux. Le bloc n'apparaît que s'il y en a. */}
      {unattached !== "missing" && unattached.length > 0 ? <section aria-label="Paiements non rattachés" className="border-t-4 border-encre pt-4">
        <h2 className="text-h2 mb-2">Paiements sans compte rattaché</h2>
        <p className="text-small text-attenue mb-4">De l&apos;argent encaissé dont personne n&apos;a reçu la contrepartie. À rattacher à la main, puis à re-signaler à Whop si besoin.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-small"><thead><tr className="border-b"><th className="py-2">Payé le</th><th>Formule</th><th>Montant</th><th>Adresse de paiement</th><th>État</th><th>Événement</th></tr></thead><tbody>
          {unattached.map((row)=><tr key={row.event_id} className="border-b"><td className="py-3">{new Date(row.paid_at).toLocaleString("fr-FR")}</td><td>{row.plan}</td><td className="tabular-nums">{row.amount === null ? "—" : `${row.amount} ${row.currency ?? ""}`}</td><td>{row.email ?? "—"}</td><td>{row.resolution === "abandonne" ? "Abandonné" : row.resolution === "rattache" ? "Rattaché" : "En attente"}</td><td className="font-mono text-xs">{row.event_id}</td></tr>)}
        </tbody></table></div>
      </section> : null}
      <p className="text-small text-attenue">{excludedNotice(data)}</p>
      <p className="text-small text-attenue">{internalNotice(data)}</p>
      <p className="text-xs text-attenue">« Analyses lancées » et « Analyses terminées » sont deux compteurs bruts : aucun taux n’est calculé entre eux, faute d’un identifiant commun permettant de suivre une même analyse du lancement à sa fin.</p>
      <p className="text-xs text-attenue">Les visites et UTM commencent avec cette instrumentation et respectent DNT. Sans identifiant anonyme persistant, l’attribution est partielle. Le revenu est disponible uniquement pour les achats futurs dont Whop fournit montant et devise.</p>
    </>}
  </main>;
}
