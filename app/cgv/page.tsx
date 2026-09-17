import type { Metadata } from "next";
import { Facts, LegalPage, LegalSection, ToFill } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";
import { SELLER } from "@/lib/legal/identity";

export const metadata: Metadata = { title: "CGV" };

// Textes fournis par l'éditeur, repris mot pour mot.
export default function TermsPage() {
  return (
    <LegalPage title="Conditions générales de vente" updated="16 septembre 2026">
      <LegalSection title="Vendeur">
        <p>
          {SELLER.name}, {SELLER.status}
          <br />
          {SELLER.address}
          <br />
          SIRET : {SELLER.siret} — {SELLER.email} — {SELLER.phone}
          <br />
          {SELLER.vatNotice}
        </p>
      </LegalSection>

      <LegalSection title="Objet">
        <p>
          Les présentes conditions régissent la vente des services d&apos;analyse proposés sur {BRAND.domain} à des
          consommateurs.
        </p>
      </LegalSection>

      <LegalSection title="Offres et prix">
        <Facts
          items={[
            "Gratuit : une analyse, sans paiement.",
            "Pack Deal : 4,99 € — trois analyses, sans date d'expiration.",
            "Pro : 12,99 € par mois — trente analyses par mois, historique des analyses, résiliable à tout moment.",
          ]}
        />
        <p>
          Les prix sont indiqués en euros, toutes taxes comprises. La TVA n&apos;est pas applicable en application de
          l&apos;article 293 B du CGI.
        </p>
      </LegalSection>

      <LegalSection title="Paiement">
        <p>
          Les paiements sont encaissés par Whop, qui agit en qualité de prestataire de paiement. {BRAND.name} ne reçoit
          ni ne conserve aucune donnée bancaire.
        </p>
      </LegalSection>

      <LegalSection title="Fourniture du service">
        <p>
          Le service est fourni immédiatement après la validation du paiement. Les crédits d&apos;analyse sont ajoutés au
          compte dès la confirmation du paiement.
        </p>
      </LegalSection>

      <LegalSection title="Droit de rétractation">
        <p>
          Le service proposé constitue un contenu numérique fourni sans support matériel, dont l&apos;exécution commence
          immédiatement après le paiement. Conformément à l&apos;article L221-28 13° du code de la consommation, le droit
          de rétractation de quatorze jours ne peut pas être exercé lorsque les trois conditions suivantes sont réunies :
        </p>
        <Facts
          items={[
            "a) le consommateur a donné préalablement son consentement exprès pour que l'exécution du contrat commence avant l'expiration du délai de rétractation ;",
            "b) il a reconnu qu'il perdra son droit de rétractation ;",
            "c) le vendeur lui a fourni une confirmation de son accord sur support durable.",
          ]}
        />
        <p>
          Ces trois conditions sont recueillies au moment du paiement au moyen d&apos;une case à cocher non pré-cochée,
          et confirmées par un email adressé à l&apos;acheteur immédiatement après l&apos;achat.
        </p>
        <p>
          À défaut, le consommateur conserve son droit de rétractation de quatorze jours à compter de la conclusion du
          contrat.
        </p>
      </LegalSection>

      <LegalSection title="Résiliation de l'abonnement Pro">
        <p>
          L&apos;abonnement Pro est résiliable à tout moment, directement en ligne, gratuitement, depuis la page
          «&nbsp;Résilier votre contrat&nbsp;» accessible depuis l&apos;espace du compte. La résiliation prend effet à la
          fin de la période en cours. Les crédits achetés séparément restent acquis.
        </p>
      </LegalSection>

      <LegalSection title="Réclamations">
        <p>
          Toute réclamation peut être adressée à {SELLER.email}. Une réponse est apportée sous quinze jours ouvrés.
        </p>
      </LegalSection>

      <LegalSection id="mediation" title="Médiation de la consommation">
        <ToFill>
          nom, adresse postale et site internet du médiateur de la consommation auprès duquel le vendeur a adhéré.
          Mention obligatoire.
        </ToFill>
      </LegalSection>

      <LegalSection title="Droit applicable">
        <p>
          Les présentes conditions sont soumises au droit français. En cas de litige, et après tentative de résolution
          amiable, les tribunaux français sont compétents.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
