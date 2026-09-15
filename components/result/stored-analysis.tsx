"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnalysisResult } from "@/components/result/analysis-result";
import { Button } from "@/components/ui/button";
import { parseStoredAnalysis, readStoredAnalysis } from "@/lib/analysis/session";

function subscribe() {
  return () => {};
}

export function StoredAnalysis() {
  // null côté serveur ; la lecture du sessionStorage se fait au rendu client.
  const raw = useSyncExternalStore(subscribe, readStoredAnalysis, () => null);
  const analysis = useMemo(() => parseStoredAnalysis(raw), [raw]);

  if (!analysis) {
    return (
      <div className="flex flex-col gap-4 py-12">
        <h1 className="text-3xl font-black tracking-tight">Aucune analyse à afficher</h1>
        <p className="text-neutral-700">Lance une analyse pour voir le résultat ici.</p>
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/analyse">Analyser mon deal</Link>
        </Button>
      </div>
    );
  }

  return <AnalysisResult analysis={analysis} />;
}
