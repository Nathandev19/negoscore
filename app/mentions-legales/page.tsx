import type { Metadata } from "next";
import { Facts, LegalPage, LegalSection, ToFill } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Mentions légales" };

export default function LegalNoticePage() {
  return (
    <LegalPage title="Mentions légales" updated="16 septembre 2026">
      <LegalSection title="Éditeur du site">
        <ToFill>
          dénomination, statut auto-entrepreneur, adresse, SIRET, email de contact, directeur de publication
        </ToFill>
        <p>
          Site : {BRAND.domain}, service d&apos;analyse d&apos;offres de collaboration pour créateurs de contenu.
        </p>
      </LegalSection>

      <LegalSection title="Hébergeur">
        <Facts
          items={[
            "Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.",
            "Base de données et fichiers : Supabase, région Union européenne.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Nature du service">
        <Facts
          items={[
            "Le service lit une offre reçue par un créateur et produit une analyse : score, points à négocier, fourchette de prix estimée, message de réponse.",
            "Le chiffrage vient d'une table de tarifs versionnée et de règles de calcul, pas d'un modèle de langage.",
            "L'analyse est éducative et fondée sur des benchmarks de marché. Ce n'est pas un conseil juridique.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Contact">
        <ToFill>adresse email de contact affichée aux utilisateurs, et délai de réponse annoncé</ToFill>
      </LegalSection>
    </LegalPage>
  );
}
