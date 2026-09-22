import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { Facts, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { RETRY_WINDOW_DAYS } from "@/lib/analysis/retry-window";
import { PRICE, PRO_PERIOD } from "@/lib/billing/plans";
import { BRAND } from "@/lib/brand";
import { COPILOT_PROMISE, ESTIMATE_DISCLAIMER, negotiations, NEGOTIATIONS, WHAT_IS_A_NEGOTIATION } from "@/lib/content/vocabulaire";
import { SELLER } from "@/lib/legal/identity";

export const metadata: Metadata = publicPageMetadata("/cgv");

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
          Les présentes conditions régissent la vente des négociations proposées sur {BRAND.domain} à des
          consommateurs.
        </p>
        <p>{WHAT_IS_A_NEGOTIATION} {COPILOT_PROMISE} {ESTIMATE_DISCLAIMER}</p>
      </LegalSection>

      <LegalSection title="Formules et prix">
        <Facts
          items={[
            `Gratuit : ${negotiations(NEGOTIATIONS.free)}, sans paiement.`,
            // Périmètre exact de lib/analysis/retry.ts : seule une analyse
            // « incomplete » ouvre la relance, et la fenêtre vient de
            // RETRY_WINDOW_DAYS (mission #061).
            `Relance gratuite : une analyse qui n'a pas pu être chiffrée, parce que l'offre de la marque ne dit pas assez quels contenus elle demande ni ce qu'elle en fera, peut être relancée une fois, sur la même offre complétée, dans les ${RETRY_WINDOW_DAYS} jours suivant l'analyse, sans frais et sans décompter de négociation, quelle que soit la formule. Une offre sans montant ou sans conditions écrites, elle, est bien chiffrée : elle n'ouvre pas de relance.`,
            // Prix pris dans la source unique (lib/billing/plans.ts) : le texte des
            // CGV ne peut pas diverger de ce qui est vendu.
            `Pack Deal : ${PRICE.pack} — ${negotiations(NEGOTIATIONS.pack)}, sans date d'expiration.`,
            `Pro : ${PRICE.pro} ${PRO_PERIOD} — jusqu'à ${negotiations(NEGOTIATIONS.proPerPeriod)} par mois, résiliable à tout moment.`,
            "L'historique des négociations est ouvert à tout compte, quelle que soit la formule : il n'est pas réservé à une formule payante.",
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
          Le service est fourni immédiatement après la validation du paiement. Les négociations achetées sont ajoutées
          au compte dès la confirmation du paiement.
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
          fin de la période en cours. Les négociations achetées séparément restent acquises.
        </p>
      </LegalSection>

      <LegalSection title="Réclamations">
        <p>
          Toute réclamation peut être adressée à {SELLER.email}. Une réponse est apportée sous quinze jours ouvrés.
        </p>
      </LegalSection>

      <LegalSection id="mediation" title="Médiation de la consommation">
        <p>
          Conformément aux articles L612-1 et suivants du code de la consommation, tu peux recourir gratuitement à un
          médiateur de la consommation en vue de la résolution amiable d&apos;un litige qui nous opposerait.
          L&apos;adhésion à un médiateur est en cours : ses coordonnées seront publiées ici dès qu&apos;elle sera
          effective, et te seront communiquées sur simple demande à {SELLER.email}.
        </p>
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
