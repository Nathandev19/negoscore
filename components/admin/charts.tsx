import type { DashboardData } from "@/lib/admin/data";

export function TimeSeries({ rows }: { rows: DashboardData["timeseries"] }) {
  if (rows.length === 0) return <p className="text-small text-attenue">Aucun événement sur cette période.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => [r.page_views, r.analyses, r.signups, r.purchases]));
  return <div><ul aria-label="Légende" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-attenue"><li>Bleu : visites</li><li>Brun : analyses</li><li>Gris : inscriptions</li><li>Noir : achats</li></ul><div className="overflow-x-auto"><svg role="img" aria-label="Activité par jour" viewBox={`0 0 ${Math.max(640, rows.length * 50)} 220`} className="min-w-[640px] w-full">
    {rows.map((row,index) => { const x=index*50+24; return <g key={row.day}>
      <rect className="text-marque" x={x} y={190-row.page_views/max*160} width="8" height={row.page_views/max*160} fill="currentColor"><title>{row.day}: {row.page_views} visites</title></rect>
      <rect className="text-encre-douce" x={x+9} y={190-row.analyses/max*160} width="8" height={row.analyses/max*160} fill="currentColor"><title>{row.day}: {row.analyses} analyses</title></rect>
      <rect className="text-attenue" x={x+18} y={190-row.signups/max*160} width="8" height={row.signups/max*160} fill="currentColor"><title>{row.day}: {row.signups} inscriptions</title></rect>
      <rect className="text-encre" x={x+27} y={190-row.purchases/max*160} width="8" height={row.purchases/max*160} fill="currentColor"><title>{row.day}: {row.purchases} achats</title></rect>
      <text x={x} y="210" fontSize="9">{row.day.slice(5)}</text>
    </g>;})}
    <line className="text-attenue" x1="16" y1="190" x2={Math.max(630,rows.length*50)} y2="190" stroke="currentColor" />
  </svg></div></div>;
}

export function Funnel({ data }: { data: DashboardData }) {
  const steps = [["Visites", (data.counts.landing_view ?? 0)+(data.counts.pricing_view ?? 0)], ["Analyses lancées", data.counts.analysis_started ?? 0], ["Analyses terminées", data.counts.analysis_completed ?? 0], ["Inscriptions", data.counts.signup ?? 0], ["Checkout", data.counts.checkout_started ?? 0], ["Achats", data.counts.purchase_completed ?? 0]] as const;
  const max=Math.max(1,...steps.map(([,v])=>v));
  return <div className="flex flex-col gap-3">{steps.map(([label,value])=><div key={label}><div className="mb-1 flex justify-between text-small"><span>{label}</span><strong>{value}</strong></div><div className="h-5 bg-filet"><div className="h-full bg-encre" style={{width:`${Math.max(value?3:0,value/max*100)}%`}} /></div></div>)}<p className="text-xs text-attenue">Étapes agrégées, sans suivi individuel entre écrans : ce funnel mesure des volumes, pas une cohorte liée.</p></div>;
}
