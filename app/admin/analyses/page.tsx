import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_PAGE_SIZE, ANALYSES_COUNT_LABELS, analysesNotice, loadAdminAnalyses } from "@/lib/admin/data";
import { dateHeureParis, MENTION_FUSEAU } from "@/lib/admin/heure";

export const metadata: Metadata = { title: "Analyses — cockpit", robots: { index: false, follow: false } };

export default async function AdminAnalyses({ searchParams }: PageProps<"/admin/analyses">) {
  const params=await searchParams; const page=Math.max(1,Number(params.page)||1); const data=await loadAdminAnalyses(page);
  return <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6"><div><h1 className="text-h1">Analyses</h1><p>Vue globale sans duplication du contenu source.</p>{data!=="missing"?<p className="mt-2 text-small text-attenue">{analysesNotice(data)}</p>:null}</div>
    {/* Mission #181 — CE QUI EXISTE, ET CE QU'IL EN RESTE. Les quatre
        premiers nombres forment une partition de la table : leur somme vaut
        le brut (lib/admin/data.ts). Sans eux, le total de la liste était
        déjà filtré et ne répondait pas à « combien de lignes existent ». */}
    {data!=="missing"&&data.counts?<section aria-label="Ce que contient la table des analyses" className="border-t-4 border-encre pt-4"><dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">{ANALYSES_COUNT_LABELS.map(({cle,label,aide})=><div key={cle}><dt className="text-small text-attenue">{label}</dt><dd className="text-h2 font-extrabold tabular-nums">{data.counts![cle]}</dd><dd className="text-xs text-attenue">{aide}</dd></div>)}</dl></section>:null}
    {data==="missing"?<p role="alert" className="alert-bad">Migration admin absente.</p>:data.items.length===0?<p>Aucune analyse.</p>:<><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-small"><thead><tr className="border-b"><th className="py-3">Date ({MENTION_FUSEAU})</th><th>Utilisateur</th><th>Score</th><th>Proposé</th><th>Estimation</th><th>Niveau initial</th><th>Feedback</th><th>Négociation</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id} className="border-b"><td className="py-4">{dateHeureParis(row.created_at)}</td><td>{row.user_id?<Link className="link" href={`/admin/users/${row.user_id}`}>{row.email??"Compte"}</Link>:"Anonyme"}</td><td>{row.score??"—"}</td><td>{row.offered_amount??"—"}</td><td>{row.estimate_low&&row.estimate_high?`${row.estimate_low}–${row.estimate_high} €`:"—"}</td><td>{row.profile_tier??"—"}</td><td>{row.feedback??"—"}</td><td>{row.turns?`${row.turns} tour(s)${row.concluded?" · conclue":""}`:"Non"}</td></tr>)}</tbody></table></div><div className="flex justify-between"><span>{data.total} analyse(s)</span><div className="flex gap-4">{page>1?<Link className="link" href={`?page=${page-1}`}>Précédent</Link>:null}{page*ADMIN_PAGE_SIZE<data.total?<Link className="link" href={`?page=${page+1}`}>Suivant</Link>:null}</div></div></>}
  </main>;
}
