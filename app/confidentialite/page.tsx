import type { Metadata } from "next";
import { Facts, LegalPage, LegalSection, ToFill } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Confidentialité" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Confidentialité" updated="16 septembre 2026">
      <LegalSection title="Responsable de traitement">
        <ToFill>
          identité du responsable de traitement, adresse, contact du DPO ou de la personne responsable des données
        </ToFill>
      </LegalSection>

      <LegalSection title="Données traitées">
        <Facts
          items={[
            "Adresse email, quand tu crées un compte par lien de connexion.",
            "Texte des offres que tu colles, et documents que tu déposes (photo ou PDF).",
            "Analyses produites à partir de ces offres, conservées sur ton compte.",
            "Adresse IP hachée (HMAC-SHA256 avec un sel serveur), pour limiter le nombre d'analyses. L'adresse IP n'est jamais stockée en clair.",
            "Historique de paiement : plan, solde de crédits, période d'abonnement, consentement donné au moment du paiement avec sa date.",
            "Mesure d'audience : pages vues et actions dans le service, sans le contenu des offres, sans montant et sans email.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Finalités">
        <Facts
          items={[
            "Fournir le service : lire l'offre, produire l'analyse, te la réafficher.",
            "Limiter les abus et le nombre d'analyses gratuites.",
            "Gérer les comptes, les crédits et les paiements.",
            "Mesurer l'audience du service pour l'améliorer.",
          ]}
        />
        <ToFill>base légale de chacun de ces traitements (contrat, intérêt légitime, consentement)</ToFill>
      </LegalSection>

      <LegalSection title="Durées de conservation">
        <Facts
          items={[
            "Documents déposés (photo, PDF) : supprimés 30 jours après le dépôt.",
            "Analyses et compte : conservés tant que le compte existe, supprimés sur demande.",
            "Compteurs d'usage rattachés à une IP hachée : fenêtre glissante de 30 jours maximum.",
          ]}
        />
        <ToFill>durée de conservation des données de facturation et des consentements</ToFill>
      </LegalSection>

      <LegalSection title="Sous-traitants">
        <Facts
          items={[
            "Supabase : hébergement de la base de données et des fichiers déposés, région Union européenne.",
            "Vercel : hébergement de l'application.",
            "OpenAI : lecture de l'offre et rédaction de l'analyse.",
            "Resend : envoi des emails de connexion.",
            "Whop : encaissement des paiements.",
            "PostHog : mesure d'audience, région Union européenne.",
          ]}
        />
        <ToFill>
          mention sur les transferts hors Union européenne (Vercel, OpenAI, Whop) et garanties associées
        </ToFill>
      </LegalSection>

      <LegalSection title="Tes droits">
        <Facts
          items={[
            "Accès, rectification, effacement, portabilité, opposition et limitation.",
            "Réclamation auprès de la CNIL, autorité française de protection des données.",
          ]}
        />
        <ToFill>adresse email à utiliser pour exercer ces droits, et délai de traitement annoncé</ToFill>
      </LegalSection>

      <LegalSection title="Cookies et traceurs">
        <Facts
          items={[
            "Cookies techniques : session de connexion et jeton anonyme rattaché à une analyse faite sans compte.",
            "Mesure d'audience : le signal « Do Not Track » de ton navigateur est respecté, et l'enregistrement de session est désactivé.",
          ]}
        />
        <ToFill>bandeau de consentement aux traceurs : nécessaire ou non selon la configuration retenue</ToFill>
      </LegalSection>
    </LegalPage>
  );
}
