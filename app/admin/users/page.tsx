import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_PAGE_SIZE, loadAdminUsers } from "@/lib/admin/data";

export const metadata: Metadata = { title: "Utilisateurs — cockpit", robots: { index: false, follow: false } };

function badge(row: { plan: string | null; period_end: string | null; admin_grant: boolean; balance: number }) {
  const paid = row.plan === "pro" && row.period_end && new Date(row.period_end).getTime() > Date.now();
  if (paid) return "PRO — SUBSCRIPTION";
  if (row.admin_grant) return "PRO — ADMIN GRANT";
  return row.balance > 0 ? "PACK" : "FREE";
}

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const params=await searchParams; const search=typeof params.q==="string"?params.q:""; const page=Math.max(1,Number(params.page)||1); const sort=typeof params.sort==="string"?params.sort:"recent";
  const data=await loadAdminUsers({search,page,sort});
  return <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6"><div><h1 className="text-h1">Utilisateurs</h1><p>Accès, crédits et activité. Pagination effectuée côté serveur.</p></div>
    <form className="grid gap-3 sm:grid-cols-[1fr_13rem_auto]"><input name="q" defaultValue={search} placeholder="Rechercher un email" className="rounded-control border bg-creme px-3 py-2"/><select name="sort" defaultValue={sort} className="rounded-control border bg-creme px-3 py-2"><option value="recent">Inscription récente</option><option value="activity">Activité récente</option><option value="analyses">Plus d’analyses</option><option value="email">Email</option></select><button className="rounded-control bg-encre px-4 py-2 font-semibold text-creme">Filtrer</button></form>
    {data==="missing"?<p role="alert" className="alert-bad">Migration admin absente.</p>:data.items.length===0?<p>Aucun utilisateur.</p>:<><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-small"><thead><tr className="border-b"><th className="py-3">Compte</th><th>Accès</th><th>Crédits</th><th>Analyses</th><th>Inscription</th><th>Dernière activité</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id} className="border-b"><td className="py-4"><Link className="link" href={`/admin/users/${row.id}`}>{row.email??"Email absent"}</Link></td><td><span className="rounded-pill border px-2 py-1 text-xs font-bold">{badge(row)}</span></td><td>{row.balance}</td><td>{row.analyses}</td><td>{new Date(row.created_at).toLocaleDateString("fr-FR")}</td><td>{new Date(row.last_activity).toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div><div className="flex justify-between"><span>{data.total} compte(s)</span><div className="flex gap-4">{page>1?<Link className="link" href={`?q=${encodeURIComponent(search)}&sort=${sort}&page=${page-1}`}>Précédent</Link>:null}{page*ADMIN_PAGE_SIZE<data.total?<Link className="link" href={`?q=${encodeURIComponent(search)}&sort=${sort}&page=${page+1}`}>Suivant</Link>:null}</div></div></>}
  </main>;
}
