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

export const metadata: Metadata = publicPageMetadata("/exclusivite-ugc");

// Mission #171 — deuxième page de la série « une clause d'offre, une page ».
//
// Relevé de la page 1 de Google le 09/10/2026 sur « clause d'exclusivité
// UGC ». Les trois premiers : un article éditorial (ugcmatch.io), un billet
// de cabinet d'avocats (abaa-avocat.com) et un article de plateforme destiné
// aux MARQUES (kayba.co), où l'exclusivité est la cinquième de cinq clauses,
// en quatre lignes. Aucun des trois ne met un euro en face. Le seul chiffre
// de la page 1 est un « 20 à 50 % » présenté comme une pratique du métier,
// sans calcul derrière, et il est écrit du point de vue de l'acheteur.
//
// Cette page-ci chiffre, et elle chiffre pour la créatrice : la durée, le
// niveau, le cumul avec les autres lignes, et le plafond. Tous les nombres
// viennent de la table courante et du moteur ; tests/guides-reference.test.tsx
// les recalcule un par un. Les liens internes portent `?de=exclusivite-ugc`,
// jamais un paramètre utm (mission #152).
const ORIGINE = "exclusivite-ugc";

export default function ExclusivityPage() {
  return (
    <>
      <SiteHeader />
      <ViewPixel page="/exclusivite-ugc" />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 font-extrabold">Exclusivité : la marque t&apos;interdit ses concurrents, ça vaut combien ?</h1>
          <p className="measure">
            Les autres clauses achètent quelque chose que tu as déjà fait : une vidéo, le droit de la diffuser. Celle-ci
            n&apos;achète rien. Elle t&apos;interdit de gagner de l&apos;argent ailleurs pendant qu&apos;elle court.
            C&apos;est pour ça qu&apos;elle se paie, et qu&apos;elle se paie à part.
          </p>
          <p className="measure font-semibold text-encre">
            La réponse courte : compte 30 à 50 % du prix de création pour trois mois, 60 à 90 % pour six.
          </p>
        </div>

        <Section title="En euros, pour une vidéo">
          <p>
            Trois mois d&apos;exclusivité sur une catégorie, le cas le plus fréquent. Les montants ci-dessous sont le
            total : la vidéo plus l&apos;exclusivité.
          </p>
          <RateTable
            head={["Ton niveau", "Une vidéo, exclusivité 3 mois"]}
            rows={[
              ["Je débute", "130 à 270 €"],
              ["J'ai déjà fait des collabs payées", "320 à 750 €"],
              ["C'est mon métier", "650 à 1 200 €"],
            ]}
          />
          <p>
            Pour trois vidéos au niveau «&nbsp;Je débute&nbsp;», le tournage seul vaut 280 à 504 € avec la dégressivité
            de volume. Trois mois d&apos;exclusivité ajoutent 80 à 256 €, et six mois ajoutent{" "}
            <strong className="font-semibold text-encre">160 à 456 €</strong>.
          </p>
          <p className="text-xs text-attenue">
            Estimation fondée sur des benchmarks de marché, pas un tarif officiel. Table de tarifs{" "}
            <span className="tabular-nums">{CURRENT_RATE_VERSION}</span>.
          </p>
        </Section>

        <Section title="Ce que la clause t'interdit, et ce qu'elle ne t'interdit pas">
          <p>
            Une exclusivité ne t&apos;empêche pas de parler du produit, ni de travailler. Elle t&apos;empêche de
            travailler pour un concurrent. Toute la question est là : qui est un concurrent ?
          </p>
          <ul className="flex flex-col gap-4">
            <Point lead={<>Une catégorie, pas un marché.</>}>
              «&nbsp;Soin du visage&nbsp;» est une catégorie. «&nbsp;La beauté&nbsp;» n&apos;en est pas une : ça te
              ferme tout, et personne ne te paie pour tout.
            </Point>
            <Point lead={<>Des dates, pas une impression.</>}>
              Une date de début et une date de fin. Sans date de fin écrite, la clause ne s&apos;éteint pas toute
              seule.
            </Point>
            <Point lead={<>Deux ou trois noms valent mieux qu&apos;une famille.</>}>
              Si la marque a des concurrents précis en tête, demande-lui de les nommer. Une liste de trois marques se
              respecte ; «&nbsp;tout concurrent direct ou indirect&nbsp;» ne se vérifie pas.
            </Point>
          </ul>
          <p>
            Si tu ne filmes qu&apos;une catégorie, une exclusivité large n&apos;est pas une contrainte : c&apos;est une
            interdiction d&apos;exercer. Elle se refuse, ou elle se paie au prix d&apos;un mois de travail.
          </p>
        </Section>

        <Section title="Le barème par durée">
          <p>
            La majoration monte avec la durée, et elle monte vite : c&apos;est une part de ton marché qui se ferme,
            pas un fichier qu&apos;on copie une fois de plus.
          </p>
          <RateTable
            head={["Durée de l'exclusivité", "À ajouter"]}
            rows={[
              ["1 mois", "+15 à +25 %"],
              ["3 mois", "+30 à +50 %"],
              ["6 mois et plus", "+60 à +90 %"],
            ]}
          />
          <p>
            Le barème s&apos;arrête à six mois, et c&apos;est une limite de notre table, pas une limite du métier. Une
            exclusivité de douze ou vingt-quatre mois sort de ce qu&apos;on sait chiffrer : traite-la comme un contrat
            à part, au-dessus de ces fourchettes, et demande une clause de sortie.
          </p>
        </Section>

        <Section title="Une durée qui n'est pas écrite vaut trois mois">
          <p>
            C&apos;est la phrase qu&apos;on lit le plus souvent dans un brief :
            «&nbsp;exclusivité catégorie pendant la campagne&nbsp;». Ce n&apos;est pas une durée. La campagne peut
            s&apos;arrêter au bout de trois semaines et la clause courir encore.
          </p>
          <p>
            Quand la durée manque, notre chiffrage suppose trois mois et l&apos;écrit en toutes lettres dans ton
            analyse, plutôt que de faire comme si la ligne était gratuite. Mais une hypothèse n&apos;est pas un accord :
            la seule bonne réponse est de faire écrire la date de fin.
          </p>
        </Section>

        <Section title="L'exclusivité n'est pas une cession de droits">
          <p>
            Les deux arrivent dans la même phrase et ne se facturent pas pareil. Les{" "}
            <Link href={internalHrefFrom("/droits-utilisation", ORIGINE)} className="link">
              droits d&apos;utilisation
            </Link>{" "}
            disent ce que la marque a le droit de faire de ta vidéo. L&apos;exclusivité dit ce que TU n&apos;as plus le
            droit de faire, ailleurs.
          </p>
          <p>
            Une marque peut acheter{" "}
            <Link href={internalHrefFrom("/droits-pub-6-mois", ORIGINE)} className="link">
              six mois de droits publicitaires
            </Link>{" "}
            sans aucune exclusivité, et l&apos;inverse existe aussi. Deux lignes, deux prix, et tu peux accepter
            l&apos;une en refusant l&apos;autre.
          </p>
          <p>
            Le cas à refuser sans hésiter : une exclusivité contre des{" "}
            <Link href={internalHrefFrom("/produits-offerts", ORIGINE)} className="link">
              produits offerts
            </Link>
            . Tu renonces à des clients réels contre un colis.
          </p>
        </Section>

        <Section title="Il y a un plafond, et il te protège aussi">
          <p>
            Les suppléments ne s&apos;additionnent pas à l&apos;infini. L&apos;ensemble des majorations est plafonné à
            +150 % du prix de création, et ce plafond ne monte à +250 % que si la marque demande l&apos;usage à vie ou
            la cession totale des droits.
          </p>
          <p>
            Concrètement : trois vidéos au niveau «&nbsp;Je débute&nbsp;», six mois de pub et six mois
            d&apos;exclusivité, ça fait 580 à 1 260 € — et c&apos;est le plafond qui fixe la borne haute, pas la somme
            des lignes.{" "}
            <Link href={internalHrefFrom("/combien-facturer", ORIGINE)} className="link">
              Le détail format par format
            </Link>{" "}
            montre comment chaque supplément s&apos;empile.
          </p>
        </Section>

        <Section title="Quoi répondre, concrètement">
          <p>
            Tu n&apos;as pas besoin de refuser. Tu as besoin de la nommer comme une ligne, et de lui demander ses trois
            bornes :
          </p>
          <blockquote className="measure rounded-control border-2 border-filet p-4 text-encre">
            «&nbsp;Pas de souci sur le principe de l&apos;exclusivité. Chez moi c&apos;est une ligne séparée : trois
            mois sur une catégorie, c&apos;est 30 à 50 % en plus du prix de création. Tu me précises la catégorie
            exacte, la date de fin et le territoire, et je t&apos;envoie le devis complet derrière.&nbsp;»
          </blockquote>
          <p>
            Une marque qui tient à son exclusivité la paie et la resserre. Une marque qui l&apos;avait mise par habitude
            la retire — et tu viens de récupérer ton calendrier sans perdre le deal.
          </p>
        </Section>

        <Section title="Chiffre ton offre, pas une moyenne">
          <p>
            Ces fourchettes ne savent pas combien de vidéos la marque demande, ni ce qu&apos;elle ajoute à côté. Colle
            le message tel que tu l&apos;as reçu : on te donne la fourchette pour ton offre précise et ce qui manque
            dedans, gratuitement et sans compte. La réponse à envoyer, mot pour mot, se débloque avec ton email.
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

// Même découpe que les quatre autres guides : un filet, un titre, le texte.
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

// Même tableau que /combien-facturer : deux colonnes, lisible dès 320 px, la
// deuxième alignée à droite et insécable.
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
          <tr key={label} className="border-b border-filet">
            <th scope="row" className="py-2 pr-3 font-normal">
              {label}
            </th>
            <td className="figures py-2 text-right font-semibold whitespace-nowrap text-encre">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
