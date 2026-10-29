import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { Facts, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BRAND } from "@/lib/brand";
import { COOKIES } from "@/lib/legal/cookies";
import { SELLER } from "@/lib/legal/identity";

export const metadata: Metadata = publicPageMetadata("/confidentialite");

// Textes fournis par l'éditeur, repris mot pour mot.
export default function PrivacyPage() {
  // Mission #209 quater — LA DATE SUIT LE CONTENU, et une garde le fait tenir.
  //
  // Elle annonçait le 17 septembre alors que la section « Mesure d'audience »
  // décrivait depuis la #209 ter le comportement en page : un lecteur qui se
  // fie à la date croit avoir déjà tout lu.
  //
  // Elle reste écrite à la main, et c'est un choix mesuré : la dériver d'un
  // horodatage de fichier ou d'un commit donnerait une date FAUSSE à chaque
  // déploiement, parce qu'un clone neuf ne conserve ni les dates de
  // modification ni l'historique par fichier. Ce qui empêche le défaut de
  // revenir est ailleurs : tests/pages-legales.test.tsx fige une empreinte du
  // contenu rendu de chaque page légale à côté de sa date. Changer un mot sans
  // changer la date fait échouer le test, et il dit quoi faire.
  return (
    <LegalPage title="Politique de confidentialité" updated="30 octobre 2026">
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
            "Empreinte technique d'un appareil, calculée à partir de l'adresse IP et du navigateur avec une valeur aléatoire renouvelée chaque jour — distinguer deux visites d'une même journée dans les statistiques — intérêt légitime — l'adresse IP n'est jamais conservée, et l'empreinte cesse d'avoir un sens dès le lendemain.",
            "Domaine du site qui t'a envoyé ici — comprendre d'où viennent les visites sans indication de campagne — intérêt légitime — ni l'URL complète ni ses paramètres ne sont conservés.",
            "Demande de lien de connexion faite depuis un navigateur qui a lancé une analyse sans compte : l'adresse demandée, le jeton anonyme de ce navigateur et l'empreinte d'un code glissé dans le lien (le code lui-même n'est pas gardé) — rattacher cette analyse à ton compte, même si tu ouvres le lien dans un autre navigateur — exécution du contrat.",
            "Email de l'acheteur, montant et formule achetée — preuve de la transaction et suivi des paiements — obligation légale et intérêt légitime.",
            `Coordonnées bancaires — traitées exclusivement par Whop, jamais reçues ni conservées par ${BRAND.name}.`,
            "Mesure d'audience — statistiques d'usage anonymes, calculées et conservées par le site lui-même, sans aucun outil tiers — intérêt légitime.",
            "Comportement sur la page d'accueil : jusqu'où la page a été défilée, combien de temps elle est restée affichée, le délai avant le premier geste et l'onglet du formulaire touché en premier — comprendre si la page est lue, et où la lecture s'arrête — intérêt légitime — relevé en tranches, sans identifiant et sans jamais le contenu de ce qui est collé dans le champ.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Durées de conservation">
        <Facts
          items={[
            "Documents déposés : supprimés 30 jours après l'analyse.",
            "Texte des offres collé dans le champ d'analyse : supprimé 30 jours après l'analyse. L'analyse, elle, reste disponible et conserve la marque, les montants et des phrases rédigées par l'outil d'analyse, qui peuvent citer le prénom de ton interlocuteur. Supprimer l'analyse efface tout.",
            "Compte et analyses : jusqu'à la suppression du compte par l'utilisateur. Une analyse lancée sans compte est supprimée au bout de 30 jours au maximum, avec l'offre qui l'a produite : c'est aussi la durée pendant laquelle ce navigateur peut la consulter et la supprimer lui-même.",
            "Réponses d'une marque que tu colles pour suivre l'échange : supprimées 30 jours après avoir été collées. Ce que l'outil en a tiré (termes lus, chiffrage, message proposé) reste avec l'analyse, et part avec elle quand tu supprimes l'analyse ou ton compte.",
            "Message que tu copies depuis l'outil pour l'envoyer à une marque, ou que tu corriges avant de coller sa réponse : conservé avec l'analyse, pour lire la réponse suivante à la lumière de ce que tu as vraiment envoyé, et supprimé avec elle ou avec ton compte.",
            "Avis sur une estimation (réponse et commentaire facultatif de 200 caractères au plus, que tu rédiges toi-même) : conservés tant que l'analyse existe, et supprimés avec elle, que tu supprimes l'analyse ou ton compte.",
            "Journal des paiements et preuves de consentement : 5 ans, y compris après la suppression du compte.",
            "Adresses IP hachées : 30 jours au maximum.",
            "Empreinte technique d'appareil : 7 jours. La valeur aléatoire qui permet de la calculer est détruite au bout de 2 jours : passé ce délai, deux journées ne peuvent plus être rapprochées.",
            "Demande de lien de connexion : effacée dès que le lien sert. Sinon, elle ne sert plus au bout de 2 heures, et la purge quotidienne l'efface au plus tard le lendemain.",
            "Statistiques d'usage, y compris les relevés de comportement sur la page d'accueil : 13 mois, puis les lignes sont supprimées. C'est la plus courte des deux durées que la CNIL cite pour la mesure d'audience sans consentement. Rien ne nous y oblige, puisque cette mesure ne dépose rien sur ton appareil : on la retient quand même, parce qu'une donnée qu'on ne garde pas est une donnée qu'on ne peut pas perdre.",
            "Données de facturation détenues par Whop : selon ses propres durées.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Suppression de ton compte">
        <p>
          Tu peux supprimer ton compte depuis la page Mon compte, sans justification. Une seule réserve : un abonnement
          Pro encore actif et non résilié doit d&apos;abord être résilié, parce que supprimer le compte ne l&apos;arrêterait
          pas et qu&apos;il continuerait à être prélevé. La résiliation est gratuite et en ligne ; dès qu&apos;elle est
          enregistrée, la suppression est possible, sans attendre la fin de la période déjà payée. Sont supprimés
          immédiatement : ton identifiant de connexion, ton adresse email, les offres que tu as déposées, les documents
          téléversés et les analyses produites. Sont conservés : le journal des paiements et les preuves de consentement
          liées à tes achats, pendant 5 ans, afin de pouvoir justifier d&apos;une transaction en cas de litige. Les
          négociations non utilisées sont perdues et ne sont pas remboursées.
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
          ]}
        />
        {/* Mission #122, corrigée par #123 — Whop ne figure plus dans cette
            liste. Un sous-traitant traite pour le compte du responsable ; Whop
            opère le règlement par carte et la taxe POUR SON PROPRE COMPTE, en
            tant que merchant of record sur ces deux points, et à ce titre
            décide lui-même du traitement des données de la transaction.

            Il ne vend pas : le vendeur est l'éditeur (voir les CGV). Et aucune
            entité juridique n'est nommée ici — elle change selon la région de
            l'acheteur. */}
        <p>
          Whop n&apos;est pas un sous-traitant : il opère le paiement et la taxe pour son propre compte. Pour les
          données de la transaction — coordonnées bancaires, adresse de facturation, reçu — il est responsable de
          traitement à part entière et applique sa propre politique de confidentialité, sur laquelle{" "}
          {BRAND.name} n&apos;a pas la main.
        </p>
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
          La mesure d&apos;audience ne dépose rien sur ton appareil : aucun cookie, aucun stockage local. Pour
          distinguer deux visites d&apos;une même journée, une empreinte technique est calculée à partir de ton
          adresse IP et de ton navigateur, avec une valeur aléatoire renouvelée chaque jour et détruite ensuite :
          elle ne permet pas de te reconnaître d&apos;un jour à l&apos;autre, et ton adresse IP n&apos;est conservée
          nulle part. C&apos;est pourquoi aucune bannière de consentement ne t&apos;est présentée. Elle est calculée
          et conservée par le site lui-même : aucun outil de mesure extérieur n&apos;est chargé, et rien n&apos;est
          transmis à un tiers. Le seul cookie qu&apos;elle lit est celui qui marque un appareil de l&apos;équipe du
          site (ns_interne, décrit plus haut), pour écarter nos propres visites de nos statistiques.
        </p>
        <p>
          Les pages publiques contiennent une image d&apos;un pixel, transparente, qui sert uniquement à compter la
          page affichée. Elle ne dépose rien et ne permet pas de te reconnaître d&apos;un jour à l&apos;autre.
        </p>
        <p>
          Sur la page d&apos;accueil, quatre repères sont relevés pour comprendre ce que les visiteurs font de la
          page : jusqu&apos;où tu as fait défiler la page, combien de temps elle est restée affichée, combien de
          temps s&apos;est écoulé avant ton premier geste, et quel onglet du formulaire a été touché en premier
          («&nbsp;coller le message&nbsp;», «&nbsp;photo&nbsp;» ou «&nbsp;PDF&nbsp;»). Les durées et la profondeur
          sont arrondies en tranches, jamais gardées au détail : «&nbsp;entre 5 et 10 secondes&nbsp;», pas
          «&nbsp;7,4 secondes&nbsp;». Un seul relevé part par page affichée, au moment où tu la quittes, et il ne
          contient rien d&apos;autre que ces quatre tranches.
        </p>
        <p>
          Ce qui n&apos;est jamais relevé : le texte que tu colles dans le champ, ni même sa longueur. Savoir que le
          champ a été touché ne dit rien de ce qui a été écrit dedans. Ne sont enregistrés ni les mouvements de la
          souris, ni l&apos;endroit des clics, ni les touches frappées, ni le nombre de gestes — seulement le délai
          avant le premier, quel qu&apos;il soit. Aucun identifiant n&apos;accompagne ces relevés : rien ne
          rapproche deux pages entre elles, ni deux visites. Et rien n&apos;est déposé sur ton appareil pour les
          obtenir : ni cookie, ni stockage local.
        </p>
        <p>
          Les statistiques d&apos;usage ne contiennent ni le texte des offres, ni les noms de marques, ni les montants
          proposés, ni les adresses email. Les signaux «&nbsp;Do Not Track&nbsp;» et «&nbsp;Global Privacy Control&nbsp;»
          du navigateur sont respectés : rien n&apos;est enregistré.
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
