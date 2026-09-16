import type { Metadata } from "next";
import { Facts, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";
import { SELLER } from "@/lib/legal/identity";

export const metadata: Metadata = { title: "Confidentialité" };

// Textes fournis par l'éditeur, repris mot pour mot.
export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" updated="16 septembre 2026">
      <LegalSection title="Responsable du traitement">
        <p>
          {SELLER.name}, {SELLER.address.replace(", France", "")}.
          <br />
          Contact : {SELLER.email}
        </p>
      </LegalSection>

      <LegalSection title="Données traitées et finalités">
        <Facts
          items={[
            "Adresse email — création et accès au compte — exécution du contrat.",
            "Texte et documents des offres déposées — production de l'analyse — exécution du contrat.",
            "Analyses produites — affichage et historique — exécution du contrat.",
            "Adresse IP sous forme hachée — limitation des abus et de l'usage gratuit — intérêt légitime.",
            `Données de paiement — traitées exclusivement par Whop, jamais reçues ni conservées par ${BRAND.name}.`,
            "Mesure d'audience — statistiques d'usage anonymes — intérêt légitime.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Durées de conservation">
        <Facts
          items={[
            "Documents déposés : supprimés 30 jours après l'analyse.",
            "Compte et analyses : jusqu'à la suppression du compte par l'utilisateur.",
            "Données de facturation : conservées par Whop selon ses propres durées.",
            "Preuves de consentement au paiement : conservées pendant la durée de prescription applicable aux contrats de consommation.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Sous-traitants">
        <Facts
          items={[
            "Supabase — base de données et stockage des fichiers — Union européenne.",
            "Vercel — hébergement de l'application — États-Unis.",
            "OpenAI — analyse automatisée du contenu des offres — États-Unis.",
            "Resend — envoi des emails — Union européenne.",
            "Whop — encaissement des paiements — États-Unis.",
            "PostHog — mesure d'audience — Union européenne.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Transferts hors Union européenne">
        <p>
          Certains sous-traitants sont établis aux États-Unis. Ces transferts sont encadrés par les clauses
          contractuelles types de la Commission européenne ou par un mécanisme équivalent prévu par le RGPD.
        </p>
      </LegalSection>

      <LegalSection title="Contenu des offres déposées">
        <p>
          Le texte des offres est transmis au prestataire d&apos;analyse automatisée pour produire le résultat. Aucun
          contenu d&apos;offre n&apos;est utilisé à des fins publicitaires, ni transmis à un tiers en dehors de ce
          traitement, ni publié sans accord écrit préalable de l&apos;utilisateur.
        </p>
      </LegalSection>

      <LegalSection title="Mesure d'audience">
        <p>
          Les statistiques d&apos;usage ne contiennent ni le texte des offres, ni les noms de marques, ni les montants
          proposés, ni les adresses email. Le signal «&nbsp;Do Not Track&nbsp;» du navigateur est respecté.
        </p>
      </LegalSection>

      <LegalSection title="Droits">
        <p>
          Accès, rectification, effacement, limitation, portabilité et opposition.
          <br />
          Ces droits s&apos;exercent à {SELLER.email}.
          <br />
          En cas de désaccord, réclamation possible auprès de la CNIL, 3 place de Fontenoy, TSA 80715, 75334 Paris Cedex
          07,{" "}
          <a href="https://www.cnil.fr" className="underline">
            www.cnil.fr
          </a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
