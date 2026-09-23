import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_PAGE_SIZE, loadAdminAnalyses } from "@/lib/admin/data";

export const metadata: Metadata = { title: "Analyses — cockpit", robots: { index: false, follow: false } };

export default async function AdminAnalyses({ searchParams }: PageProps<"/admin/analyses">) {
  const params=await searchParams; const page=Math.max(1,Number(params.page)||1); const data=await loadAdminAnalyses(page);
  return <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6"><div><h1 className="text-h1">Analyses</h1><p>Vue globale sans duplication du contenu source.</p></div>
    {data==="missing"?<p role="alert" className="alert-bad">Migration admin absente.</p>:data.items.length===0?<p>Aucune analyse.</p>:<><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-small"><thead><tr className="border-b"><th className="py-3">Date</th><th>Utilisateur</th><th>Score</th><th>Proposé</th><th>Estimation</th><th>Niveau</th><th>Feedback</th><th>Négociation</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id} className="border-b"><td className="py-4">{new Date(row.created_at).toLocaleString("fr-FR")}</td><td>{row.user_id?<Link className="link" href={`/admin/users/${row.user_id}`}>{row.email??"Compte"}</Link>:"Anonyme"}</td><td>{row.score??"—"}</td><td>{row.offered_amount??"—"}</td><td>{row.estimate_low&&row.estimate_high?`${row.estimate_low}–${row.estimate_high} €`:"—"}</td><td>{row.profile_tier??"—"}</td><td>{row.feedback??"—"}</td><td>{row.turns?`${row.turns} tour(s)${row.concluded?" · conclue":""}`:"Non"}</td></tr>)}</tbody></table></div><div className="flex justify-between"><span>{data.total} analyse(s)</span><div className="flex gap-4">{page>1?<Link className="link" href={`?page=${page-1}`}>Précédent</Link>:null}{page*ADMIN_PAGE_SIZE<data.total?<Link className="link" href={`?page=${page+1}`}>Suivant</Link>:null}</div></div></>}
  </main>;
}
