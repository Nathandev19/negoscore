import type { Metadata } from "next";
import Link from "next/link";
import { Funnel, TimeSeries } from "@/components/admin/charts";
import { ADMIN_PERIODS, loadDashboard, parsePeriod } from "@/lib/admin/data";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Cockpit", robots: { index: false, follow: false } };

const labels = { "24h": "24 h", "7d": "7 jours", "30d": "30 jours", all: "Tout" } as const;
const n = (value: number | undefined) => new Intl.NumberFormat("fr-FR").format(value ?? 0);

export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  const params = await searchParams;
  const period = parsePeriod(params.period);
  const data = await loadDashboard(period);
  const visits = data === "missing" ? 0 : (data.counts.landing_view ?? 0) + (data.counts.pricing_view ?? 0);
  const analysisRate = data === "missing" || visits === 0 ? "—" : `${Math.round(((data.counts.analysis_started ?? 0) / visits) * 100)} %`;
  const fairRate = data === "missing" || data.feedback.total === 0 ? "—" : `${Math.round((data.feedback.fair / data.feedback.total) * 100)} %`;
  return <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 md:py-14">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-small font-semibold uppercase tracking-widest text-marque">Aujourd’hui et tendances</p><h1 className="text-h1">Cockpit {BRAND.name}</h1></div><div className="flex flex-wrap gap-2">{ADMIN_PERIODS.map((p)=><Link key={p} href={`/admin?period=${p}`} aria-current={p===period?"page":undefined} className={`rounded-pill border px-3 py-1 text-small font-semibold ${p===period?"bg-encre text-creme":"bg-creme text-encre"}`}>{labels[p]}</Link>)}</div></div>
    {data === "missing" ? <p role="alert" className="alert-bad">Le cockpit attend la migration admin 20260923000030.</p> : <>
      <section aria-label="Indicateurs" className="grid gap-px overflow-hidden border border-filet bg-filet sm:grid-cols-2 lg:grid-cols-4">
        {[["Visites mesurées",n(visits)],["Analyses lancées",n(data.counts.analysis_started)],["Analyses terminées",n(data.counts.analysis_completed)],["Taux visite → analyse",analysisRate],["Inscriptions",n(data.counts.signup)],["Feedbacks",n(data.feedback.total)],["Estimations jugées justes",fairRate],["Achats",n(data.purchases.purchases)],[`Revenu EUR couvert (${data.purchases.revenue_covered}/${data.purchases.purchases})`,new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(data.purchases.revenue_eur)],["Pro payants",n(data.paid_pro)],["Pro offerts",n(data.granted_pro)]].map(([label,value])=><div key={String(label)} className="bg-creme p-5"><p className="text-small text-attenue">{label}</p><p className="figures mt-2 text-3xl text-encre">{value}</p></div>)}
      </section>
      <section className="grid gap-8 lg:grid-cols-[1.35fr_1fr]"><div className="min-w-0 border-t-4 border-marque pt-4"><h2 className="text-h2 mb-5">Activité</h2><TimeSeries rows={data.timeseries} /></div><div className="border-t-4 border-encre pt-4"><h2 className="text-h2 mb-5">Funnel agrégé</h2><Funnel data={data} /></div></section>
      <section className="grid gap-8 lg:grid-cols-2"><div><h2 className="text-h2 mb-4">Acquisition</h2>{data.acquisition.length===0?<p className="text-attenue">Aucune attribution disponible.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-small"><thead><tr className="border-b"><th className="py-2">Source / campagne / contenu</th><th>Visites</th><th>Analyses</th><th>Achats</th></tr></thead><tbody>{data.acquisition.map((r)=><tr key={`${r.source}/${r.campaign}/${r.content}`} className="border-b"><td className="py-3"><strong>{r.source}</strong><br/><span className="text-attenue">{r.campaign} · {r.content}</span></td><td>{r.visits}</td><td>{r.analyses}</td><td>{r.purchases}</td></tr>)}</tbody></table></div>}</div>
      <div><h2 className="text-h2 mb-4">Feedback estimation</h2><div className="grid grid-cols-3 gap-px bg-filet border border-filet">{[["Total",data.feedback.total],["Juste",data.feedback.fair],["Pas juste",data.feedback.not_fair]].map(([label,value])=><div key={String(label)} className="bg-creme p-4"><p className="text-small text-attenue">{label}</p><p className="figures text-2xl">{value}</p></div>)}</div></div></section>
      <p className="text-xs text-attenue">Les visites et UTM commencent avec cette instrumentation et respectent DNT. Sans identifiant anonyme persistant, l’attribution est partielle. Le revenu est disponible uniquement pour les achats futurs dont Whop fournit montant et devise.</p>
    </>}
  </main>;
}
