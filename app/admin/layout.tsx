import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { SiteHeader } from "@/components/site-header";
import { isOwner } from "@/lib/admin/owner";
import { getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Cockpit", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isOwner(await getViewer())) notFound();
  return <><SiteHeader /><AdminNav />{children}</>;
}
