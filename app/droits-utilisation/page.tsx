import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { ViewPixel } from "@/components/analytics/view-pixel";
import { exampleHrefFrom, internalHrefFrom } from "@/lib/analytics/views";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";
import { CURRENT_RATE_VERSION } from "@/lib/rates/tables";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/droits-utilisation");

// Mission #158 — voir le commentaire de app/combien-facturer/page.tsx :
// origine interne sur chaque lien vers un autre guide, jamais d'utm.
const ORIGINE = "droits-utilisation";

// Page publique statique (mission #052). Le texte d'origine est fourni par
// l'éditeur et repris au mot près : seul le balisage est de nous. La citation de
// l'article L131-3 est reproduite telle quelle, guillemets compris, et vérifiée
// par tests/rights-page.test.tsx.
//
// Mission #216 — CETTE PAGE DEVIENT LE PILIER DU CLUSTER DES DROITS, et DEUX
// SECTIONS ONT ÉTÉ AJOUTÉES. Elles sont signalées #216 dans le balisage ; aucun
// mot du texte d'origine n'a changé, et ce commentaire ne peut donc plus dire
// que toute la page vient de l'éditeur.
//
// Pourquoi ces deux-là, et pas d'autres : Search Console, trois mois au
// 22/11/2026, « achat de droits ugc » fait 24 impressions et c'est la première
// requête du site. La page ne contenait pas ces mots, et ne disait nulle part
// ce qu'un achat de droits recouvre ni ce que chaque ligne coûte — alors que son
// titre promet « le vrai prix ». Les deux manques sont comblés ici, et les
// détails restent sur les satellites : une ligne par clause, chacune renvoyant
// à la page qui la chiffre.
export default function UsageRightsPage() {
  return (
    <>
      <SiteHeader />
      <ViewPixel page="/droits-utilisation" />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 font-extrabold">Droits d&apos;utilisation : ce que tu vends vraiment</h1>
          <p className="measure">
            Une marque te propose 300 € pour trois vidéos. Tu dis oui, tu tournes, tu envoies. Six mois plus tard tes
            vidéos passent en pub sur TikTok, sur Insta, peut-être en magasin. Tes 300 €, ils payaient le tournage. La
            diffusion, elle, tu l&apos;as donnée. Et une marque qui achète six mois de pub à un prestataire, elle ne les
            paie jamais zéro — elle les paie à toi zéro parce que tu ne savais pas que c&apos;était une ligne à part.
          </p>
        </div>

        <Section title="Créer et diffuser, ce sont deux factures">
          <p>
            Quand tu tournes une vidéo, tu vends ton temps, ton matériel, ton visage et ton montage. Ça, c&apos;est la
            création. Ça se facture une fois.
          </p>
          <p>
            Quand la marque diffuse cette vidéo, elle utilise quelque chose qui t&apos;appartient. Ça, c&apos;est un
            droit. Ça se facture selon combien de temps, sur quels supports, et sur quel territoire. Une agence qui
            achète une image de banque d&apos;images le sait très bien : le prix change selon l&apos;usage. Toi, on te
            propose un forfait unique et on espère que tu ne poseras pas la question.
          </p>
          <p className="font-semibold text-encre">
            La question, c&apos;est : est-ce que mes 300 €, ils paient le tournage ou le tournage plus six mois de
            publicité ?
          </p>
        </Section>

        <Section title="Ce que dit la loi">
          <p>
            On n&apos;est pas avocats, et ce qui suit n&apos;est pas un conseil juridique. Mais le texte est public et
            il tient en une phrase. Article L131-3 du Code de la propriété intellectuelle :
          </p>
          {/* Citation reproduite exactement, guillemets compris. */}
          <blockquote className="measure border-l-4 border-encre py-1 pl-4 text-encre italic">
            «&nbsp;La transmission des droits de l&apos;auteur est subordonnée à la condition que chacun des droits
            cédés fasse l&apos;objet d&apos;une mention distincte dans l&apos;acte de cession et que le domaine
            d&apos;exploitation des droits cédés soit délimité quant à son étendue et à sa destination, quant au lieu et
            quant à la durée.&nbsp;»
          </blockquote>
          <p>
            Traduit : une marque qui veut diffuser ton contenu doit écrire quoi, pour quoi faire, où, et pendant combien
            de temps. Quatre choses. Un message qui dit seulement «&nbsp;on pourra utiliser le contenu sur nos
            réseaux&nbsp;» n&apos;en précise aucune.
          </p>
          <p>
            Et l&apos;autre moitié compte autant : ce que tu n&apos;as pas cédé, tu l&apos;as gardé. Le silence
            n&apos;est pas une autorisation.
          </p>
        </Section>

        {/* Mission #216 — AJOUT. Nomme « achat de droits » (les mots tapés) et
            relie les quatre délimitations de l'article L131-3 citées juste
            au-dessus à ce qu'elles valent plus bas. Rien ici ne répète la
            citation : elle est au-dessus, une fois. */}
        <Section title="Un achat de droits, qu'est-ce qu'on t'achète">
          <p>
            «&nbsp;Achat de droits&nbsp;», «&nbsp;droits d&apos;utilisation&nbsp;», «&nbsp;droits d&apos;usage&nbsp;» :
            trois façons de nommer la même chose. Ce n&apos;est pas la vidéo qu&apos;on t&apos;achète, c&apos;est
            l&apos;autorisation de s&apos;en servir — et une autorisation sans bornes n&apos;en est pas une.
          </p>
          <p>
            Les quatre délimitations de l&apos;article cité juste au-dessus sont donc aussi les quatre choses qui ont un
            prix : chacun des droits cédés, l&apos;étendue et la destination de l&apos;exploitation, le lieu, la durée.
            Une offre qui n&apos;en précise aucune ne te propose pas un petit budget, elle te propose un budget pour
            quelque chose que personne n&apos;a encore défini.
          </p>
          <p>
            Deux cas se distinguent du reste, et ils ont chacun leur page. Si la marque veut diffuser sans limite de
            durée ou devenir propriétaire des vidéos, ce n&apos;est plus une autorisation d&apos;usage, c&apos;est une{" "}
            <Link href={internalHrefFrom("/cession-droits-ugc", ORIGINE)} className="link">
              cession
            </Link>
            . Et si tu veux savoir ce qui doit être{" "}
            <Link href={internalHrefFrom("/contrat-ugc", ORIGINE)} className="link">
              écrit noir sur blanc
            </Link>{" "}
            pour que ces quatre bornes existent vraiment, c&apos;est là.
          </p>
        </Section>

        <Section title="Les quatre questions qui fixent le prix">
          <p>
            Avant de donner un chiffre, tu dois connaître ces quatre réponses. Si la marque ne les donne pas, ce
            n&apos;est pas un détail à régler plus tard — c&apos;est le prix qui n&apos;est pas encore calculable.
          </p>
          <ul className="flex flex-col gap-4">
            <Point lead={<>Combien de temps.</>}>
              Trois mois, six mois, un an. «&nbsp;À vie&nbsp;» et «&nbsp;en perpétuité&nbsp;» ne sont pas des durées, ce
              sont des ventes.
            </Point>
            <Point lead={<>Pour quoi faire.</>}>
              Un repost sur leur compte, ce n&apos;est pas la même chose qu&apos;une pub payante. Une pub payante, ce
              n&apos;est pas la même chose qu&apos;une affiche en magasin ou un spot télé.
            </Point>
            <Point lead={<>Où.</>}>
              La France, l&apos;Europe, le monde. Une marque qui vend dans trois pays ne paie pas les droits monde.
            </Point>
            <Point lead={<>Est-ce que tu t&apos;interdis quelque chose.</>}>
              Si tu ne peux plus travailler avec un concurrent pendant trois mois, tu ne vends pas seulement une vidéo,
              tu vends une part de ton activité.
            </Point>
          </ul>
        </Section>

        <Section title="Ce que ça vaut, en plus du tournage">
          {/* Seul lien ajouté vers le guide des tarifs (mission #054) : aucun mot du texte n'a changé. */}
          <p>
            Ce sont les{" "}
            <Link href={internalHrefFrom("/combien-facturer", ORIGINE)} className="link">
              ordres de grandeur
            </Link>{" "}
            que {BRAND.name} applique, au-dessus du prix de création :
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              Six mois de droits publicitaires : compte 50 % à 70 % du prix de création en plus.
            </li>
            <li>
              <Link href={internalHrefFrom("/exclusivite-ugc", ORIGINE)} className="link">
                Trois mois d&apos;exclusivité
              </Link>{" "}
              sur la catégorie : compte 30 % à 50 % en plus.
            </li>
          </ul>
          {/* Mission #158 — les deux durées les plus demandées ont désormais
              leur page chiffrée ; cette section-ci donne le principe. */}
          <p>
            Six mois, c&apos;est la durée qu&apos;on nous demande le plus :{" "}
            <Link href={internalHrefFrom("/droits-pub-6-mois", ORIGINE)} className="link">
              ce que tu factures en plus pour six mois de pub
            </Link>{" "}
            est chiffré en euros, niveau par niveau.
          </p>
          <p>
            Un exemple concret. Trois vidéos TikTok et une story chez un créateur qui débute, ça vaut entre 300 et 540 €
            de création. Ajoute six mois de droits pub et trois mois d&apos;exclusivité, et l&apos;offre juste monte
            entre 540 et 1 190 €. La marque, elle, en a proposé 300.
          </p>
        </Section>

        {/* Mission #216 — AJOUT. Le titre de la page promet « le vrai prix » :
            il manquait l'index des prix. UNE LIGNE PAR CLAUSE, et le détail
            reste sur la page qui chiffre chacune — ce n'est donc pas une
            répétition des satellites, c'est leur sommaire. Tous les
            pourcentages viennent de la table courante, et
            tests/cluster-droits.test.tsx les recalcule un par un. */}
        <Section title="Ce que chaque ligne coûte, en un coup d'œil">
          <p>
            Les majorations ci-dessous s&apos;ajoutent au prix de création, en pourcentage de ce prix. Elles se cumulent,
            et c&apos;est pour ça qu&apos;une offre «&nbsp;tous supports, monde, à vie&nbsp;» ne se chiffre pas de tête.
          </p>
          <RateTable
            head={["Ce que la marque obtient", "À ajouter"]}
            rows={[
              ["Diffusion publicitaire, 1 mois", "+20 à +30 %"],
              ["Diffusion publicitaire, 6 mois", "+50 à +70 %"],
              ["Diffusion publicitaire, 12 mois", "+80 à +120 %"],
              ["Diffusion publicitaire à vie", "+150 à +250 %"],
              ["Publicité depuis ton compte (1 mois)", "+25 à +35 %"],
              ["Exclusivité sur la catégorie, 3 mois", "+30 à +50 %"],
              ["Exclusivité sur la catégorie, 6 mois et plus", "+60 à +90 %"],
              ["Les rushs bruts", "+35 à +45 %"],
              ["Diffusion dans le monde entier", "+20 à +30 %"],
              ["Cession totale des droits", "+100 à +200 %"],
            ]}
          />
          <p>
            Trois de ces lignes ont leur page, avec le détail par niveau et en euros :{" "}
            <Link href={internalHrefFrom("/droits-pub-6-mois", ORIGINE)} className="link">
              six mois de pub
            </Link>
            ,{" "}
            <Link href={internalHrefFrom("/exclusivite-ugc", ORIGINE)} className="link">
              l&apos;exclusivité
            </Link>{" "}
            et la{" "}
            <Link href={internalHrefFrom("/cession-droits-ugc", ORIGINE)} className="link">
              cession
            </Link>
            .
          </p>
          <p className="text-xs text-attenue">
            Estimation fondée sur des benchmarks de marché, pas un tarif officiel. Table de tarifs{" "}
            <span className="tabular-nums">{CURRENT_RATE_VERSION}</span>.
          </p>
        </Section>

        <Section title="Les trois pièges qu'on voit le plus">
          <ul className="flex flex-col gap-4">
            <Point lead={<>«&nbsp;Droits d&apos;utilisation inclus&nbsp;», sans durée.</>}>
              Inclus jusqu&apos;à quand ? Sans réponse écrite, tu ne sais pas ce que tu vends.
            </Point>
            <Point lead={<>«&nbsp;Tous supports, tous territoires, illimité&nbsp;».</>}>
              C&apos;est la formule la plus chère du marché, présentée comme une formalité administrative.
            </Point>
            <Point lead={<>L&apos;exclusivité offerte.</>}>
              Elle n&apos;apparaît presque jamais sur la facture, et c&apos;est pourtant la ligne qui te coûte le plus :
              elle te ferme des clients que tu n&apos;auras jamais.
            </Point>
          </ul>
        </Section>

        <Section title="Quoi répondre, concrètement">
          <p>
            Tu n&apos;as pas besoin d&apos;être agressif, ni de sortir un contrat. Une question suffit, et elle change
            la conversation :
          </p>
          <blockquote className="measure rounded-control border-2 border-filet p-4 text-encre">
            «&nbsp;Merci ! Avant de valider, tu peux me préciser l&apos;usage : c&apos;est un repost organique ou vous
            comptez passer les vidéos en publicité ? Et sur quelle durée et quels territoires ? Je fixe mon tarif
            là-dessus, je te fais une proposition juste derrière.&nbsp;»
          </blockquote>
          <p>
            Une marque sérieuse répond en trois lignes. Une marque qui espérait que tu ne demandes pas, tu le sauras à
            sa réponse.
          </p>
          {/* Mission #158 — le cas où il n'y a pas d'argent du tout : c'est la
              même conversation, et elle a sa page. */}
          <p>
            Et si la réponse est qu&apos;il n&apos;y a pas de budget, mais des{" "}
            <Link href={internalHrefFrom("/produits-offerts", ORIGINE)} className="link">
              produits offerts
            </Link>{" "}
            : la diffusion publicitaire, elle, se paie quand même en euros.
          </p>
        </Section>

        <Section title="Vérifie ton offre">
          <p>
            Colle le message que la marque t&apos;a envoyé. On te dit ce que le deal vaut en euros et ce qui manque
            dedans : c&apos;est gratuit et sans compte. La réponse à envoyer, mot pour mot, se débloque avec ton email.
          </p>
          <Button asChild size="lg" className="mt-1 h-12 w-full text-base sm:w-fit">
            <Link href="/analyse">Analyser mon deal</Link>
          </Button>
          {/* Mission #119 — une seconde sortie, pour qui n'a rien à coller
              tout de suite. Un lien, pas un composant : la page reste entière
              sans JavaScript (mission #074). */}
          {/* Mission #120 — le lien porte son origine : c'est la seule
              façon de savoir combien de lecteurs d'un guide vont voir
              l'exemple, sans lire le référent dans le navigateur. */}
          <Link href={exampleHrefFrom(ORIGINE)} className="link w-fit">
            {FULL_EXAMPLE.label}
          </Link>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

// Même découpe que les pages légales : un filet, un titre, le texte.
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

// Mission #216 — même tableau que /combien-facturer, /exclusivite-ugc et
// /cession-droits-ugc : deux colonnes, lisible dès 320 px, la deuxième alignée
// à droite et insécable.
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
