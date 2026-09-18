import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { Facts, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";
import { COOKIES } from "@/lib/legal/cookies";
import { SELLER } from "@/lib/legal/identity";

export const metadata: Metadata = publicPageMetadata("/confidentialite");

// Textes fournis par l'éditeur, repris mot pour mot.
export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" updated="17 septembre 2026">
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
            "Niveau choisi pour le calcul des tarifs (je débute, déjà des collabs payées, c'est mon métier) — préférence de calcul, gardée dans un cookie du navigateur et, avec un compte, sur le compte — exécution du contrat — jusqu'à ce que tu en changes, ou à la suppression du compte (cookie : 12 mois).",
            "Adresse IP sous forme hachée — limitation des abus et de l'usage gratuit — intérêt légitime — conservée 30 jours au maximum.",
            "Demande de lien de connexion faite depuis un navigateur qui a lancé une analyse sans compte : l'adresse demandée, le jeton anonyme de ce navigateur et l'empreinte d'un code glissé dans le lien (le code lui-même n'est pas gardé) — rattacher cette analyse à ton compte, même si tu ouvres le lien dans un autre navigateur — exécution du contrat.",
            "Email de l'acheteur, montant et formule achetée — preuve de la transaction et suivi des paiements — obligation légale et intérêt légitime.",
            `Coordonnées bancaires — traitées exclusivement par Whop, jamais reçues ni conservées par ${BRAND.name}.`,
            "Mesure d'audience — statistiques d'usage anonymes — intérêt légitime.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Durées de conservation">
        <Facts
          items={[
            "Documents déposés : supprimés 30 jours après l'analyse.",
            "Texte des offres collé dans le champ d'analyse : supprimé 30 jours après l'analyse. L'analyse, elle, reste disponible et conserve la marque, les montants et des phrases rédigées par l'outil d'analyse, qui peuvent citer le prénom de ton interlocuteur. Supprimer l'analyse efface tout.",
            "Compte et analyses : jusqu'à la suppression du compte par l'utilisateur. Une analyse lancée sans compte est supprimée au bout de 30 jours au maximum, avec l'offre qui l'a produite : c'est aussi la durée pendant laquelle ce navigateur peut la consulter et la supprimer lui-même.",
            "Avis sur une estimation (réponse et commentaire facultatif de 200 caractères au plus, que tu rédiges toi-même) : conservés tant que l'analyse existe, et supprimés avec elle, que tu supprimes l'analyse ou ton compte.",
            "Journal des paiements et preuves de consentement : 5 ans, y compris après la suppression du compte.",
            "Adresses IP hachées : 30 jours au maximum.",
            "Demande de lien de connexion : effacée dès que le lien sert. Sinon, elle ne sert plus au bout de 2 heures, et la purge quotidienne l'efface au plus tard le lendemain.",
            "Données de facturation détenues par Whop : selon ses propres durées.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Suppression de ton compte">
        <p>
          Tu peux supprimer ton compte depuis la page Mon compte, sans justification. Si tu as un abonnement Pro en
          cours, il faut d&apos;abord le résilier : la suppression devient possible à la fin de la période déjà payée.
          Sont supprimés
          immédiatement : ton identifiant de connexion, ton adresse email, les offres que tu as déposées, les documents
          téléversés et les analyses produites. Sont conservés : le journal des paiements et les preuves de consentement
          liées à tes achats, pendant 5 ans, afin de pouvoir justifier d&apos;une transaction en cas de litige. Les crédits
          d&apos;analyse non utilisés sont perdus et ne sont pas remboursés.
        </p>
        <p>
          Avec ou sans compte, tu peux aussi supprimer une analyse depuis sa page de résultat, avec le navigateur ou le
          compte qui l&apos;a lancée : l&apos;analyse, le texte de l&apos;offre et le fichier déposé sont supprimés
          immédiatement.
        </p>
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
          Le texte que tu colles, les captures d&apos;écran et les PDF que tu déposes sont transmis en entier au
          prestataire d&apos;analyse automatisée (OpenAI, États-Unis). Une capture contient tout ce qui est à
          l&apos;écran : si d&apos;autres conversations, ton nom ou une photo y figurent, ils partent aussi. Rogne ta
          capture avant de l&apos;envoyer si tu veux l&apos;éviter. Aucun contenu d&apos;offre n&apos;est utilisé à des
          fins publicitaires, ni transmis à un tiers en dehors de ce traitement, ni publié sans accord écrit préalable
          de l&apos;utilisateur.
        </p>
      </LegalSection>

      <LegalSection title="Cookies et stockage dans ton navigateur">
        <p>
          Les cookies ci-dessous servent au fonctionnement du service. Aucun ne sert à la publicité ni à te suivre sur
          d&apos;autres sites.
        </p>
        <Facts items={[...COOKIES]} />
        <p>
          Brouillon du texte collé : le texte d&apos;une offre que tu es en train de coller est gardé dans le stockage
          local de ton navigateur, pour que tu ne le perdes pas si tu quittes la page. Il ne quitte pas ton appareil
          tant que tu ne lances pas l&apos;analyse. Il est effacé dès qu&apos;une analyse aboutit, ou au bout de 24
          heures.
        </p>
      </LegalSection>

      <LegalSection title="Mesure d'audience">
        <p>
          La mesure d&apos;audience ne dépose ni ne lit rien sur ton appareil : aucun cookie, aucun stockage local,
          aucun identifiant conservé d&apos;une visite à l&apos;autre. C&apos;est pourquoi aucune bannière de
          consentement ne t&apos;est présentée.
        </p>
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
          <a href="https://www.cnil.fr" className="link">
            www.cnil.fr
          </a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
