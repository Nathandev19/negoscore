import Link from "next/link";

const links = [["/admin", "Vue d’ensemble"], ["/admin/users", "Utilisateurs"], ["/admin/analyses", "Analyses"]] as const;

export function AdminNav() {
  return <nav aria-label="Cockpit" className="border-b border-filet"><div className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 py-3 text-small font-semibold sm:px-6">{links.map(([href,label]) => <Link key={href} href={href} className="whitespace-nowrap text-encre hover:text-marque">{label}</Link>)}</div></nav>;
}
