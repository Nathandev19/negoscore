import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { ViewPixel } from "@/components/analytics/view-pixel";
import { exampleHrefFrom, internalHrefFrom } from "@/lib/analytics/views";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";
import { SEUIL_ASSIETTE, SEUIL_CE_QUE_LE_PRODUIT_COMPTE, WRITTEN_CONTRACT_THRESHOLD_EUR } from "@/lib/legal/fr";
import { formatEur } from "@/lib/money";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/contrat-ugc");

// Mission #216 — PREMIÈRE PAGE SATELLITE DU CLUSTER DES DROITS, ET ELLE EST
// CHOISIE SUR LES DONNÉES.
//
// Search Console, trois mois au 22/11/2026 : les seules requêtes qui rendent
// quelque chose sont « achat de droits ugc » (24 impressions), « négos » (6, et
// c'est de la navigation, pas une intention de contenu) et « contrat ugc »
// (3). Aucune page du dépôt ne couvrait « contrat ugc » : les cinq guides
// parlent de prix, de durées et de clauses, jamais de l'écrit lui-même.
//
// Elle ne répète pas /droits-utilisation. Le pilier répond à « qu'est-ce que je
// vends et combien ça vaut » ; celle-ci répond à « qu'est-ce qui doit être
// écrit, et quand l'écrit est-il obligatoire ». La citation intégrale de
// l'article L131-3, guillemets compris, reste sur le pilier et ne se recopie
// pas ici : cette page porte l'EXIGENCE, pas la citation.
//
// LES DEUX PHRASES DE L'ASSIETTE DU SEUIL SONT CELLES DE lib/legal/fr.ts,
// rendues telles quelles comme sur /produits-offerts (mission #215) : le
// contenu et l'analyse ne peuvent pas énoncer deux règles différentes, parce
// que c'est la même constante.
//
// ET LA CONDITION DE CHAMP DE LA #215 S'APPLIQUE ICI AUSSI : on n'affirme pas
// l'obligation de contrat écrit sans dire quand elle s'applique. La loi du
// 9 juin 2023 ne couvre que qui mobilise sa notoriété auprès de son audience ;
// hors de là, c'est L131-3 qui porte seul le volet contractuel.
//
// Aucune référence juridique au-delà de celles de la #215, et une garde le
// vérifie : tests/cluster-droits.test.tsx.
const ORIGINE = "contrat-ugc";

export default function UgcContractPage() {
  return (
    <>
      <SiteHeader />
      <ViewPixel page="/contrat-ugc" />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 font-extrabold">Contrat UGC : ce qui doit y être écrit</h1>
          <p className="measure">
            La plupart des collabs se concluent dans un DM. Pas de contrat, pas de devis signé : un message, un accord,
            et on tourne. Ça marche jusqu&apos;au jour où la marque diffuse plus longtemps, plus large ou autrement que
            ce que tu avais en tête — et là, ce qui n&apos;a pas été écrit ne se discute plus, il se suppose.
          </p>
          <p className="measure font-semibold text-encre">
            La réponse courte : un écrit n&apos;a pas besoin d&apos;être un contrat d&apos;avocat. Un échange de
            messages qui nomme les quatre bornes de l&apos;autorisation en est un, et il se demande en une phrase.
          </p>
        </div>

        <Section title="Les quatre choses qu'un écrit doit délimiter">
          <p>
            Dès qu&apos;une marque obtient le droit d&apos;utiliser ton contenu, c&apos;est une cession de droits
            d&apos;auteur. L&apos;article&nbsp;L131-3 du Code de la propriété intellectuelle dit ce qu&apos;un tel acte
            doit préciser, et il n&apos;y met aucune condition de montant ni d&apos;audience. Quatre choses, et il faut
            les quatre :
          </p>
          <ul className="flex flex-col gap-4">
            <Point lead={<>Chacun des droits cédés, mentionné à part.</>}>
              «&nbsp;Tous droits cédés&nbsp;» ne délimite rien. Reproduire, diffuser, modifier, sous-licencier à un
              distributeur : ce ne sont pas les mêmes droits, et ils se listent.
            </Point>
            <Point lead={<>L&apos;étendue et la destination.</>}>
              Deux choses, pas une. L&apos;étendue, c&apos;est jusqu&apos;où va le droit : un support, plusieurs, tous.
              La destination, c&apos;est à quelle fin il sert : promouvoir ce produit-là, ou alimenter une bibliothèque
              interne réutilisable pour le reste du catalogue.
            </Point>
            <Point lead={<>Le lieu.</>}>
              Une zone nommée, pas un sous-entendu. «&nbsp;Nos réseaux&nbsp;» n&apos;est pas un lieu : un compte
              Instagram est visible de partout, et c&apos;est précisément l&apos;argument qu&apos;on te sortira si tu
              n&apos;as rien écrit. Le{" "}
              <Link href={internalHrefFrom("/droits-utilisation", ORIGINE)} className="link">
                territoire a un prix
              </Link>
              , donc il a besoin d&apos;une frontière.
            </Point>
            <Point lead={<>La durée.</>}>
              Un terme, ou une formule qui en tient lieu. Attention au piège : une absence de durée ne veut pas dire
              «&nbsp;court&nbsp;», elle veut dire que la question reste ouverte — et une question ouverte se tranche
              plus tard, par celui qui a le contrat sous les yeux.
            </Point>
          </ul>
          <p>
            Le texte exact de l&apos;article, reproduit mot pour mot, est sur la page{" "}
            <Link href={internalHrefFrom("/droits-utilisation", ORIGINE)} className="link">
              droits d&apos;utilisation
            </Link>
. Ce qu&apos;il faut en retenir ici : un droit qui n&apos;a pas été nommé n&apos;a pas été
            donné. Un usage absent de l&apos;écrit n&apos;est donc pas couvert, même si personne n&apos;y voyait
            d&apos;objection le jour où vous en avez parlé.
          </p>
        </Section>

        <Section title="Quand un contrat écrit est obligatoire">
          <p>
            Il existe une obligation d&apos;écrit en droit français, mais elle ne couvre pas tout le monde, et
            c&apos;est la partie qu&apos;on oublie de dire. La loi n°&nbsp;2023-451 du 9 juin 2023 sur l&apos;influence
            commerciale ne s&apos;applique qu&apos;à qui mobilise sa notoriété auprès de son audience pour promouvoir un
            produit ou un service. Autrement dit : tu publies sur tes comptes.
          </p>
          <p>
            Dans ce cadre, son article&nbsp;8 impose un contrat écrit à partir de{" "}
            {formatEur(WRITTEN_CONTRACT_THRESHOLD_EUR)}&nbsp;HT, seuil fixé par le décret n°&nbsp;2025-1137 du
            28&nbsp;novembre 2025, en vigueur depuis le 1er&nbsp;janvier 2026.
          </p>
          <p>
            {SEUIL_ASSIETTE} {SEUIL_CE_QUE_LE_PRODUIT_COMPTE}
          </p>
          <p>
            Et si tu ne publies rien&nbsp;? Si la marque récupère tes vidéos pour ses propres canaux, publicité
            comprise, sans que tu postes de ton côté, cette loi-là ne s&apos;applique pas : tu n&apos;as pas mobilisé
            ton audience. L&apos;article&nbsp;L131-3, lui, s&apos;applique quand même — sans seuil de montant et sans
            condition de notoriété. C&apos;est pour ça que les quatre délimitations ci-dessus sont le socle, et
            l&apos;obligation de la loi de 2023 un cas particulier par-dessus.
          </p>
          <p className="text-xs text-attenue">
            Information générale, pas un conseil juridique. Nous ne sommes pas avocats.
          </p>
        </Section>

        <Section title="Ce qui manque le plus souvent dans un message de marque">
          <p>
            Ce ne sont pas des oublis de mauvaise foi, la plupart du temps : la personne qui t&apos;écrit recopie un
            message interne. Mais ce qui manque te coûte quelque chose.
          </p>
          <ul className="flex flex-col gap-4">
            <Point lead={<>«&nbsp;Droits d&apos;utilisation inclus&nbsp;».</>}>
              Inclus pour quel usage, et jusqu&apos;à quand&nbsp;? Sans réponse écrite, c&apos;est la marque qui
              décidera plus tard, et ce sera sa version.
            </Point>
            <Point lead={<>Pas de durée.</>}>
              La durée est la ligne qui fait le plus bouger le prix.{" "}
              <Link href={internalHrefFrom("/droits-pub-6-mois", ORIGINE)} className="link">
                Six mois de pub
              </Link>{" "}
              ne vaut pas la même chose que six mois de repost organique.
            </Point>
            <Point lead={<>«&nbsp;Les vidéos nous appartiennent&nbsp;».</>}>
              Là, ce n&apos;est plus une licence, c&apos;est une{" "}
              <Link href={internalHrefFrom("/cession-droits-ugc", ORIGINE)} className="link">
                cession totale
              </Link>
              , et une formule globale ne délimite précisément rien de ce qu&apos;elle transfère.
            </Point>
            <Point lead={<>Une exclusivité glissée dans un paragraphe.</>}>
              Elle ne t&apos;achète rien, elle t&apos;interdit des clients.{" "}
              <Link href={internalHrefFrom("/exclusivite-ugc", ORIGINE)} className="link">
                Ce qu&apos;elle vaut
              </Link>{" "}
              est chiffré.
            </Point>
            <Point lead={<>Aucun délai de paiement.</>}>
              Trente jours et soixante jours ne se trésorent pas pareil, et l&apos;échéancier est plus facile à obtenir
              avant d&apos;avoir tourné qu&apos;après.
            </Point>
          </ul>
          <p>
            Et s&apos;il n&apos;y a pas d&apos;argent du tout, mais des{" "}
            <Link href={internalHrefFrom("/produits-offerts", ORIGINE)} className="link">
              produits offerts
            </Link>{" "}
            : la valeur des produits compte dans le seuil, et la diffusion se paie quand même.
          </p>
        </Section>

        <Section title="Comment obtenir l'écrit sans sortir un contrat">
          <p>
            Tu n&apos;as pas besoin d&apos;envoyer un document de six pages. Tu as besoin que les quatre délimitations
            soient dans un fil de messages, de sa main ou de la tienne confirmée par elle. Une réponse à un message
            vaut un écrit.
          </p>
          <blockquote className="measure rounded-control border-2 border-filet p-4 text-encre">
            «&nbsp;Super, c&apos;est noté de mon côté. Je récapitule pour qu&apos;on soit d&apos;accord : 2 vidéos, que
            je publie sur mon compte, utilisables par vous en publicité pendant 6 mois, en France, sans exclusivité.
            Paiement à 30 jours. Tu me confirmes par retour&nbsp;?&nbsp;»
          </blockquote>
          <p>
            Quatre lignes, et les quatre bornes sont posées : le droit concédé, son usage, sa zone, son terme. Une
            marque sérieuse répond «&nbsp;c&apos;est bon&nbsp;». Une marque qui comptait sur le flou te corrigera — et
            tu l&apos;apprendras maintenant plutôt que dans six mois.
          </p>
          <p>
            Ce qu&apos;il reste à faire, c&apos;est de savoir ce que tout ça vaut. Les{" "}
            <Link href={internalHrefFrom("/combien-facturer", ORIGINE)} className="link">
              fourchettes de création
            </Link>{" "}
            donnent le point de départ, et chaque ligne de droits s&apos;ajoute par-dessus.
          </p>
        </Section>

        <Section title="Vérifie ce qu'on te propose">
          <p>
            Colle le message tel que tu l&apos;as reçu. On te dit ce que le deal vaut en euros, ce que la marque obtient
            exactement, et ce qui manque dans ce qu&apos;elle a écrit : c&apos;est gratuit et sans compte. La réponse à
            envoyer, mot pour mot, se débloque avec ton email.
          </p>
          <Button asChild size="lg" className="mt-1 h-12 w-full text-base sm:w-fit">
            <Link href="/analyse">Analyser mon deal</Link>
          </Button>
          <Link href={exampleHrefFrom(ORIGINE)} className="link w-fit">
            {FULL_EXAMPLE.label}
          </Link>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

// Même découpe que les cinq autres guides : un filet, un titre, le texte.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="measure flex flex-col gap-3 border-t border-filet pt-5">
      <h2 className="text-h2 font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

// Point de liste dont la première phrase porte l'idée.
function Point({ lead, children }: { lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1">
      <span className="font-semibold text-encre">{lead}</span>
      <span>{children}</span>
    </li>
  );
}
