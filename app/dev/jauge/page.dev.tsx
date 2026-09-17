import { ScoreGauge, VerdictPill } from "@/components/result/score-band";
import { bandFor } from "@/lib/rates/score";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx) : la jauge aux scores limites et
// aux cinq bandes, sans animation. /dev/jauge
const SCORES = [0, 1, 19, 20, 32, 50, 75, 99, 100];

export default function GaugePreviewPage() {
  return (
    <main id="contenu" className="on-marque grain flex min-h-screen flex-col gap-8 bg-marque px-4 py-8 text-creme sm:px-6">
      {SCORES.map((value) => (
        <section key={value} data-score={value} className="flex max-w-md flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="figures w-12 text-2xl">{value}</span>
            <VerdictPill band={bandFor(value)} />
          </div>
          <ScoreGauge score={{ value, band: bandFor(value) }} animated={false} />
        </section>
      ))}
    </main>
  );
}
