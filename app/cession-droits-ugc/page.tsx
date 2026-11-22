import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { ViewPixel } from "@/components/analytics/view-pixel";
import { exampleHrefFrom, internalHrefFrom } from "@/lib/analytics/views";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";
import { CURRENT_RATE_VERSION } from "@/lib/rates/tables";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/cession-droits-ugc");

// Mission #216 — SECONDE PAGE SATELLITE DU CLUSTER DES DROITS.
//
// La requête qui rend le plus, de loin, est « achat de droits ugc » (24
// impressions sur trois mois au 22/11/2026). Le pilier /droits-utilisation
// explique l'achat de droits sous sa forme courante — une licence, limitée dans
// le temps et l'espace. Cette page-ci traite sa forme EXTRÊME, celle que les
// messages de marque formulent le plus innocemment : la marque n'achète pas un
// droit d'usage, elle achète les vidéos.
//
// Pourquoi une page à part, et pas un paragraphe sur le pilier : c'est une
// clause d'offre distincte (`ip_transfer: "full_assignment"` dans le schéma),
// elle a sa propre ligne de prix dans la table (`ip_full_assignment`, +100 à
// +200 %), elle est la seule à déclencher à la fois le plafond « heavy » du
// moteur et la règle d'escalade vers un professionnel. Même logique que
// /droits-pub-6-mois et /exclusivite-ugc : une clause, une page, un chiffre.
//
// TOUS LES NOMBRES VIENNENT DE LA TABLE COURANTE ET DU MOTEUR.
// tests/cluster-droits.test.tsx les recalcule un par un : le jour où la table
// change, le test échoue avant la mise en ligne. Les liens internes portent
// `?de=cession-droits-ugc`, jamais un paramètre utm (mission #152).
const ORIGINE = "cession-droits-ugc";

export default function RightsAssignmentPage() {
  return (
    <>
      <SiteHeader />
      <ViewPixel page="/cession-droits-ugc" />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 font-extrabold">«&nbsp;Les vidéos nous appartiennent&nbsp;» : ça coûte combien&nbsp;?</h1>
          <p className="measure">
            La phrase passe pour une formalité. Elle arrive en fin de message, entre le délai de livraison et les
            remerciements, et elle ne demande rien de plus qu&apos;une case à cocher. Pourtant ce n&apos;est pas la même
            vente : la marque ne te loue plus ta vidéo pour un usage et une durée, elle te l&apos;achète.
          </p>
          <p className="measure font-semibold text-encre">
            La réponse courte : compte 100 à 200 % du prix de création, ajoutés par-dessus le tournage. C&apos;est la
            ligne la plus chère de toutes.
          </p>
        </div>

        <Section title="Louer et vendre, ce ne sont pas les mêmes droits">
          <p>
            Une licence, c&apos;est un droit d&apos;usage : la marque peut faire telle chose, sur tels supports,
            pendant tant de temps. Quand la durée est écoulée, le droit s&apos;arrête et tu as toujours ta vidéo. Un
            an de pub, c&apos;est une licence.
          </p>
          <p>
            Une cession, c&apos;est le transfert des droits eux-mêmes. Il n&apos;y a plus de durée à attendre, plus
            d&apos;usage à surveiller, plus de renouvellement à refacturer. La marque peut la rediffuser dans cinq ans
            sur un support que personne n&apos;avait en tête, la remonter, la décliner, sans te redemander et sans te
            repayer.
          </p>
          <p className="font-semibold text-encre">
            Le prix d&apos;une licence paie un usage. Le prix d&apos;une cession paie tous les usages à venir, y compris
            ceux que la marque n&apos;a pas encore imaginés.
          </p>
        </Section>

        <Section title="En euros, pour une vidéo">
          <p>
            Trois niveaux, parce que le même travail ne se facture pas pareil selon ce que tu peux montrer. Les
            montants ci-dessous sont le total : le tournage plus la cession.
          </p>
          <RateTable
            head={["Ton niveau", "Une vidéo, cession comprise"]}
            rows={[
              ["Je débute", "200 à 540 €"],
              ["J'ai déjà fait des collabs payées", "500 à 1 500 €"],
              ["C'est mon métier", "1 000 à 2 400 €"],
            ]}
          />
          <p>
            Pour trois vidéos au niveau «&nbsp;Je débute&nbsp;», la dégressivité de volume joue sur le tournage et la
            cession suit : le total juste se situe{" "}
            <strong className="font-semibold text-encre">entre 560 et 1 520 €</strong>, quand la marque en a souvent
            proposé 300 pour le lot.
          </p>
          <p className="text-xs text-attenue">
            Estimation fondée sur des benchmarks de marché, pas un tarif officiel. Table de tarifs{" "}
            <span className="tabular-nums">{CURRENT_RATE_VERSION}</span>.
          </p>
        </Section>

        <Section title="Comparée aux autres lignes de droits">
          <p>
            Rien d&apos;autre ne coûte ça. La cession pèse <strong className="font-semibold text-encre">+100 à +200 %</strong>{" "}
            du prix de création, là où un an entier de diffusion publicitaire en pèse +80 à +120 % ; seule la diffusion
            à vie monte plus haut, et pour une bonne raison — elle non plus ne s&apos;arrête jamais. Le{" "}
            <Link href={internalHrefFrom("/droits-utilisation", ORIGINE)} className="link">
              sommaire de toutes les lignes
            </Link>{" "}
            les met côte à côte.
          </p>
          <p>
            Une cession coûte plus qu&apos;un an de pub, et se négocie presque toujours comme si elle coûtait moins.
            Elle fait aussi partie des conditions pour lesquelles l&apos;outil conseille de faire relire le contrat par
            un professionnel avant de signer — au même titre que la{" "}
            <Link href={internalHrefFrom("/droits-utilisation", ORIGINE)} className="link">
              diffusion sans limite de durée
            </Link>
            .
          </p>
          <p>
            Et les lignes se cumulent : six mois de pub plus la cession, au niveau «&nbsp;Je débute&nbsp;», donnent 250
            à 630 €. Le haut de cette fourchette est <em>plafonné</em> — l&apos;outil refuse d&apos;empiler les
            majorations au-delà d&apos;un certain total, parce qu&apos;aucune marque ne paie ça en pratique.
            L&apos;estimation est donc prudente, et c&apos;est un argument de négociation, pas une concession.
          </p>
        </Section>

        <Section title="Les formulations qui sont une cession sans le dire">
          <p>
            Presque jamais le mot «&nbsp;cession&nbsp;». Ce sont ces phrases-là, et elles reviennent mot pour mot
            d&apos;un message à l&apos;autre :
          </p>
          <ul className="flex flex-col gap-4">
            <Point lead={<>«&nbsp;Les vidéos nous appartiennent.&nbsp;»</>}>
              La formulation la plus courante, et la plus anodine à lire. Elle dit exactement ce qu&apos;elle dit.
            </Point>
            <Point lead={<>«&nbsp;La marque devient propriétaire du contenu.&nbsp;»</>}>
              Même chose, en langage de brief. Propriétaire, c&apos;est sans durée et sans limite d&apos;usage.
            </Point>
            <Point lead={<>«&nbsp;Cession de l&apos;ensemble des droits.&nbsp;»</>}>
              Celle-là est honnête sur le fond, mais «&nbsp;l&apos;ensemble&nbsp;» ne délimite rien.
            </Point>
            <Point lead={<>«&nbsp;Buy-out&nbsp;», «&nbsp;full buyout&nbsp;».</>}>
              Le terme du métier côté agences. Il recouvre des choses très différentes selon qui l&apos;emploie, et
              c&apos;est une raison de plus de demander ce qu&apos;il recouvre ici.
            </Point>
          </ul>
          <p>
            Dans tous ces cas, l&apos;article&nbsp;L131-3 du Code de la propriété intellectuelle demande que chacun des
            droits cédés fasse l&apos;objet d&apos;une mention distincte dans l&apos;acte. Une formule globale ne
            délimite donc rien de ce qu&apos;elle prétend transférer : c&apos;est ce que le{" "}
            <Link href={internalHrefFrom("/contrat-ugc", ORIGINE)} className="link">
              contrat doit écrire
            </Link>{" "}
            qui fait la différence, pas le mot employé.
          </p>
          <p className="text-xs text-attenue">
            Information générale, pas un conseil juridique. Nous ne sommes pas avocats.
          </p>
        </Section>

        <Section title="Quoi répondre">
          <p>
            Refuser n&apos;est pas la seule sortie. Ce que tu viens de découvrir, c&apos;est que l&apos;offre ne
            portait pas sur ce que tu croyais — et il y a trois façons de répondre, dans cet ordre.
          </p>
          <ul className="flex flex-col gap-4">
            <Point lead={<>Proposer une licence longue à la place.</>}>
              «&nbsp;Je ne cède pas mes droits, mais je peux vous donner 12 mois tous supports.&nbsp;» La marque obtient
              ce dont elle a réellement besoin neuf fois sur dix, et toi tu gardes ta vidéo.
            </Point>
            <Point lead={<>Chiffrer la cession, et le dire.</>}>
              Si la marque la veut vraiment, elle se paie. Une cession annoncée à son prix est une négociation ; une
              cession offerte est un oubli.
            </Point>
            <Point lead={<>Garder les rushs.</>}>
              Même sur une cession du montage final, les fichiers sources sont une autre ligne.{" "}
              <Link href={internalHrefFrom("/produits-offerts", ORIGINE)} className="link">
                Quand il n&apos;y a pas de budget du tout
              </Link>
              , c&apos;est souvent la première chose qu&apos;on te demande en plus.
            </Point>
          </ul>
        </Section>

        <Section title="Chiffre ton offre, pas une moyenne">
          <p>
            Ces fourchettes ne savent pas combien de vidéos la marque demande, ni ce qu&apos;elle ajoute à côté. Colle
            le message tel que tu l&apos;as reçu : on te donne la fourchette pour ton offre précise, et on te dit si ce
            qu&apos;elle a écrit est une licence ou une cession. C&apos;est gratuit et sans compte. La réponse à
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

// Même découpe que les autres guides : un filet, un titre, le texte.
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

// Même tableau que /combien-facturer et /exclusivite-ugc : deux colonnes,
// lisible dès 320 px, la deuxième alignée à droite et insécable.
function RateTable({ head, rows }: { head: [string, string]; rows: Array<[string, string]> }) {
  return (
    <table className="w-full border-collapse text-left text-small">
      <thead>
        <tr className="border-b border-encre">
          <th scope="col" className="py-2 pr-3 font-semibold text-encre">
            {head[0]}
          </th>
          <th scope="col" className="py-2 text-right font-semibold text-encre">
            {head[1]}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-filet last:border-0">
            <td className="py-2 pr-3">{label}</td>
            <td className="py-2 text-right whitespace-nowrap tabular-nums">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
