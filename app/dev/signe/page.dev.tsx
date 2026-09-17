import { Logo, LogoMark, markSvg } from "@/components/brand/logo";
import { SignPixels } from "./pixels.dev";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx) : le signe à 16, 32 et 180 px,
// sur crème et sur bleu, avec la trame réelle des pixels à 16 px agrandie.
// /dev/signe
export default function SignPreviewPage() {
  return (
    <main id="contenu" className="flex flex-col gap-10 p-6">
      {(["creme", "marque"] as const).map((surface) => (
        <section
          key={surface}
          data-surface={surface}
          className={surface === "marque" ? "on-marque grain flex flex-col gap-6 bg-marque p-6" : "flex flex-col gap-6 bg-creme p-6"}
        >
          <div className="flex items-end gap-8">
            {[16, 32, 180].map((size) => (
              <LogoMark key={size} size={size} variant={surface === "marque" ? "creme" : "marque"} />
            ))}
            <Logo variant={surface === "marque" ? "creme" : "marque"} />
          </div>
          <SignPixels svg={markSvg(surface === "marque" ? "creme" : "marque", surface === "marque" ? "marque" : "creme")} />
        </section>
      ))}
      <section className="flex items-end gap-6 bg-creme p-6">
        <LogoMark size={16} variant="mono" />
        <LogoMark size={32} variant="mono" />
        {/* eslint-disable-next-line @next/next/no-img-element -- icônes générées, vues telles quelles */}
        <img src="/icon1" width={32} height={32} alt="favicon 32" />
        {/* eslint-disable-next-line @next/next/no-img-element -- icônes générées, vues telles quelles */}
        <img src="/apple-icon" width={180} height={180} alt="apple-icon 180" />
        {/* eslint-disable-next-line @next/next/no-img-element -- icônes générées, vues telles quelles */}
        <img src="/icon.svg" width={16} height={16} alt="icon.svg 16" />
      </section>
    </main>
  );
}
