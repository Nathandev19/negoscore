import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";
import { SELLER } from "@/lib/legal/identity";

export const metadata: Metadata = publicPageMetadata("/mentions-legales");

// Textes fournis par l'éditeur, repris mot pour mot.
export default function LegalNoticePage() {
  return (
    <LegalPage title="Mentions légales" updated="16 septembre 2026">
      <LegalSection title="Éditeur du site">
        <p>
          {SELLER.name}, {SELLER.status}
          <br />
          {SELLER.address}
          <br />
          SIRET : {SELLER.siret}
          <br />
          Email : {SELLER.email}
          <br />
          Téléphone : {SELLER.phone}
          <br />
          {SELLER.vatNotice}
        </p>
      </LegalSection>

      <LegalSection title="Directeur de la publication">
        <p>{SELLER.name}.</p>
      </LegalSection>

      <LegalSection title="Hébergeur">
        <p>
          Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.
          <br />
          <a href="https://vercel.com" className="link">
            https://vercel.com
          </a>
        </p>
      </LegalSection>

      <LegalSection title="Base de données et stockage des fichiers">
        <p>Supabase, hébergement dans l&apos;Union européenne.</p>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          L&apos;ensemble des contenus du site, hors documents déposés par les utilisateurs, est la propriété de
          l&apos;éditeur. Toute reproduction sans autorisation est interdite.
        </p>
      </LegalSection>

      <LegalSection title="Nature du service">
        <p>
          {BRAND.name} fournit une analyse éducative d&apos;offres de collaboration commerciale, fondée sur des benchmarks de
          marché. Les estimations de prix ne constituent pas des tarifs officiels. Le service ne constitue pas une
          consultation juridique et ne remplace pas l&apos;avis d&apos;un professionnel du droit.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
