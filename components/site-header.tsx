import Link from "next/link";
import { BRAND } from "@/lib/brand";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center px-4 py-3 sm:px-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        {BRAND.name}
      </Link>
    </header>
  );
}
