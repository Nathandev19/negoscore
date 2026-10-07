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

export const metadata: Metadata = publicPageMetadata("/droits-pub-6-mois");

// Mission #158 — première page de la série « une clause d'offre, une page ».
//
// Constat du relevé de la page 1 de Google le 07/10/2026 : aucun résultat ne
// chiffre une durée précise. Tous publient un barème général. Cette page-ci
// répond à UNE question, celle qu'on tape vraiment : « la marque veut diffuser
// ma vidéo en pub pendant six mois, je facture combien en plus ».
//
// Elle ne répète pas /droits-utilisation : cette page-là explique le PRINCIPE
// (créer et diffuser sont deux factures, ce que dit la loi, les quatre
// questions qui fixent le prix). Celle-ci chiffre une DURÉE.
//
// Tous les nombres affichés viennent de lib/rates/fr-2026.3.json et du moteur.
// tests/guides-reference.test.tsx les recalcule un par un : le jour où la table
// change, le test échoue avant la mise en ligne. Les liens internes portent
// `?de=droits-pub-6-mois`, jamais un paramètre utm (mission #152).
const ORIGINE = "droits-pub-6-mois";

export default function PaidAdsSixMonthsPage() {
  return (
    <>
      <SiteHeader />
      <ViewPixel page="/droits-pub-6-mois" />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 font-extrabold">Droits pub 6 mois : tu factures combien en plus ?</h1>
          <p className="measure">
            La marque a aimé ta vidéo et veut la passer en publicité pendant six mois. C&apos;est une ligne en plus, pas
            une faveur à rendre : le tournage, tu l&apos;as déjà facturé. La diffusion payante, c&apos;est autre chose,
            et ça se chiffre.
          </p>
          <p className="measure font-semibold text-encre">
            La réponse courte : compte 50 à 70 % du prix de création, ajoutés par-dessus le tournage.
          </p>
        </div>

        <Section title="En euros, pour une vidéo">
          <p>
            Trois niveaux, parce que le même travail ne se facture pas pareil selon ce que tu peux montrer. Les montants
            ci-dessous sont le total : le tournage plus les six mois de diffusion publicitaire.
          </p>
          <RateTable
            head={["Ton niveau", "Une vidéo, pub 6 mois comprise"]}
            rows={[
              ["Je débute", "150 à 310 €"],
              ["J'ai déjà fait des collabs payées", "370 à 850 €"],
              ["C'est mon métier", "750 à 1 360 €"],
            ]}
          />
          <p>
            Pour trois vidéos au niveau «&nbsp;Je débute&nbsp;», le tournage seul vaut 280 à 504 € avec la dégressivité
            de volume. Les six mois de pub ajoutent 140 à 356 €, et le total juste se situe{" "}
            <strong className="font-semibold text-encre">entre 420 et 860 €</strong>.
          </p>
          <p className="text-xs text-attenue">
            Estimation fondée sur des benchmarks de marché, pas un tarif officiel. Table de tarifs{" "}
            <span className="tabular-nums">{CURRENT_RATE_VERSION}</span>.
          </p>
        </Section>

        <Section title="Six mois ne coûte pas le double de trois mois">
          <p>
            La majoration ne suit pas la durée en ligne droite. Une marque qui achète six mois paie moins que deux fois
            trois mois, et c&apos;est normal : elle s&apos;engage plus longtemps d&apos;un coup.
          </p>
          <RateTable
            head={["Durée de diffusion", "À ajouter"]}
            rows={[
              ["1 mois", "+20 à +30 %"],
              ["3 mois", "+30 à +50 %"],
              ["6 mois", "+50 à +70 %"],
              ["12 mois", "+80 à +120 %"],
              ["À vie", "+150 à +250 %"],
            ]}
          />
          <p>
            Il sert aussi dans l&apos;autre sens : si six mois font sortir la marque de son budget, propose trois mois
            reconductibles plutôt que de baisser ton prix.
          </p>
          <p>
            Et si la durée n&apos;est pas écrite, elle n&apos;est pas vendue. «&nbsp;Droits pub inclus&nbsp;» sans durée
            n&apos;est pas une durée — c&apos;est le{" "}
            <Link href={internalHrefFrom("/droits-utilisation", ORIGINE)} className="link">
              principe même de la licence
            </Link>{" "}
            qui n&apos;est pas respecté.
          </p>
        </Section>

        <Section title="Six mois de pub, ce n'est pas six mois de whitelisting">
          <p>
            Deux cas se confondent souvent et ne se facturent pas du tout pareil. La pub classique, c&apos;est la marque
            qui diffuse ta vidéo depuis son compte à elle : la majoration est forfaitaire, celle du tableau ci-dessus.
          </p>
          <p>
            Le whitelisting, c&apos;est la marque qui diffuse ses publicités depuis TON compte et sous ton nom. Les
            Spark Ads, c&apos;est quand elle sponsorise une publication que tu as déjà postée. Ces deux-là se facturent
            au mois : 25 à 35 % par mois, chacun. Six mois de whitelisting, ce n&apos;est donc pas +50 % : c&apos;est de
            l&apos;ordre de +150 %.
          </p>
          <p>
            Avant de donner un chiffre, pose la question en une phrase : la diffusion se fait depuis votre compte ou
            depuis le mien ?
          </p>
        </Section>

        <Section title="Ce que les six mois ne couvrent pas">
          <p>
            Les six mois répondent à «&nbsp;pendant combien de temps&nbsp;». Il reste trois lignes que la marque demande
            souvent dans la même phrase, et qui se facturent à part.
          </p>
          <ul className="flex flex-col gap-4">
            <Point lead={<>Le territoire.</>}>
              Les fourchettes ci-dessus supposent la France. Les droits monde ajoutent 20 à 30 %. Une marque qui vend
              dans trois pays ne paie pas les droits monde.
            </Point>
            <Point lead={<>L&apos;exclusivité.</>}>
              T&apos;interdire les marques concurrentes n&apos;a rien à voir avec la diffusion : c&apos;est une ligne
              séparée, et souvent la plus chère.{" "}
              <Link href={internalHrefFrom("/combien-facturer", ORIGINE)} className="link">
                Les fourchettes par format et par supplément
              </Link>{" "}
              la chiffrent durée par durée.
            </Point>
            <Point lead={<>Les rushs bruts.</>}>
              Si la marque veut tes fichiers source pour remonter la vidéo elle-même, compte 35 à 45 % en plus. Elle
              n&apos;achète plus une vidéo, elle achète de la matière.
            </Point>
          </ul>
          <p>
            Dernier cas, fréquent et jamais chiffré : une marque qui demande six mois de pub et qui propose de te payer
            en{" "}
            <Link href={internalHrefFrom("/produits-offerts", ORIGINE)} className="link">
              produits offerts
            </Link>
            . La diffusion publicitaire se paie en euros, pas en colis.
          </p>
        </Section>

        <Section title="Il y a un plafond, et il te protège aussi">
          <p>
            Ces suppléments ne s&apos;additionnent pas à l&apos;infini. L&apos;ensemble des majorations est plafonné à
            +150 % du prix de création, et ce plafond ne monte à +250 % que si la marque demande l&apos;usage à vie ou la
            cession totale des droits.
          </p>
          <p>
            Autrement dit : six mois de pub, les droits monde et trois mois d&apos;exclusivité additionnés dépassent le
            plafond, et c&apos;est le plafond qui s&apos;applique. Un chiffre qu&apos;une marque refuse en bloc ne te
            sert à rien.
          </p>
        </Section>

        <Section title="Quoi répondre, concrètement">
          <p>
            Tu n&apos;as pas besoin de sortir un contrat. Une réponse en trois lignes suffit, et elle remet la
            diffusion à sa place — une ligne de devis :
          </p>
          <blockquote className="measure rounded-control border-2 border-filet p-4 text-encre">
            «&nbsp;Avec plaisir pour la diffusion en pub. Le tournage et la diffusion sont deux lignes séparées chez
            moi : six mois de droits publicitaires, c&apos;est 50 à 70 % en plus du prix de création. Tu me confirmes la
            durée, les plateformes et le territoire, et je t&apos;envoie le devis complet derrière.&nbsp;»
          </blockquote>
          <p>
            Une marque qui a un budget média répond en deux messages. Une marque qui espérait que la diffusion passe
            dans le forfait, tu le sauras à sa réponse.
          </p>
        </Section>

        <Section title="Chiffre ton offre, pas une moyenne">
          <p>
            Ces fourchettes ne savent pas combien de vidéos la marque demande, ni ce qu&apos;elle ajoute à côté. Colle le
            message tel que tu l&apos;as reçu : on te donne la fourchette pour ton offre précise et ce qui manque dedans,
            gratuitement et sans compte. La réponse à envoyer, mot pour mot, se débloque avec ton email.
          </p>
          <Button asChild size="lg" className="mt-1 h-12 w-full text-base sm:w-fit">
            <Link href="/analyse">Analyser mon deal</Link>
          </Button>
          {/* Même seconde sortie que les trois autres guides (#119) : un lien,
              pas un composant, pour que la page tienne sans JavaScript (#074),
              et qui porte son origine pour être mesurable (#120). */}
          <Link href={exampleHrefFrom(ORIGINE)} className="link w-fit">
            {FULL_EXAMPLE.label}
          </Link>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

// Même découpe que les trois autres guides : un filet, un titre, le texte.
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
