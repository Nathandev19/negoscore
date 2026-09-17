import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/combien-facturer");

// Page publique statique (mission #054), même gabarit que /droits-utilisation.
// Texte fourni par l'éditeur, repris au mot près : seul le balisage est de
// nous. Tous les chiffres des tableaux viennent de lib/rates/fr-2026.3.json et
// des règles de lib/rates/engine.ts ; tests/pricing-page.test.tsx les recalcule
// depuis la table et échoue si elle change.
export default function PricingGuidePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 font-extrabold">Combien facturer une collab de marque</h1>
          <p className="measure">
            Tu cherches un chiffre. Le problème, c&apos;est que les grilles qu&apos;on trouve partout répondent à une
            seule question — combien vaut une vidéo — alors qu&apos;une offre de marque en pose cinq. La vidéo,
            c&apos;est souvent la moitié de la facture. Le reste, personne ne te le compte.
          </p>
          <p className="measure">Voici les fourchettes qu&apos;on applique, et surtout ce qui les fait bouger.</p>
        </div>

        <Section title="Le prix de base, par vidéo">
          <p>Trois niveaux, parce que le même travail ne se facture pas pareil selon ce que tu peux montrer.</p>
          <RateTable
            head={["Ton niveau", "Une vidéo"]}
            rows={[
              ["Je débute", "100 à 180 €"],
              ["J'ai déjà fait des collabs payées", "250 à 500 €"],
              ["C'est mon métier", "500 à 800 €"],
            ]}
          />
          <p>
            Les autres formats se comptent par rapport à une vidéo : une story vaut un quart d&apos;une vidéo, une photo
            un tiers environ, un live autant qu&apos;une vidéo.
          </p>
          <p>
            Si tu publies sur plusieurs plateformes, compte 10 à 20 % en plus par plateforme au-delà de la première. Le
            tournage est le même, la diffusion ne l&apos;est pas.
          </p>
        </Section>

        <Section title="Trois vidéos ne coûtent pas trois fois une vidéo">
          <p>
            C&apos;est le point que les grilles ratent le plus souvent. Quand tu tournes plusieurs vidéos d&apos;un
            coup, tu installes une fois, tu éclaires une fois, tu lis le brief une fois. La deuxième vidéo te coûte
            moins que la première. La huitième encore moins.
          </p>
          <p>Au niveau «&nbsp;Je débute&nbsp;», sans droits ni exclusivité :</p>
          <RateTable
            head={["Vidéos", "Fourchette"]}
            rows={[
              ["1", "100 à 180 €"],
              ["2", "200 à 360 €"],
              ["3", "280 à 510 €"],
              ["5", "430 à 780 €"],
              ["10", "780 à 1 410 €"],
            ]}
          />
          <p>
            Une marque qui te demande dix vidéos ne paie pas dix fois le prix d&apos;une. Elle ne paie pas non plus la
            moitié.
          </p>
        </Section>

        <Section title="Ce qui s'ajoute par-dessus">
          <p>
            La création, c&apos;est ton temps. Tout ce qui suit, c&apos;est ce que la marque fait de ton travail après.
            Ça se facture en plus, en pourcentage du prix de création.
          </p>
          <p>
            {/* Seul lien de la section (A7) : la page qui explique ce qu'est une licence. */}
            <Link href="/droits-utilisation" className="link">
              Droits publicitaires
            </Link>{" "}
            — la marque passe ta vidéo en pub payante :
          </p>
          <RateTable
            head={["Durée", "À ajouter"]}
            rows={[
              ["1 mois", "+20 à +30 %"],
              ["3 mois", "+30 à +50 %"],
              ["6 mois", "+50 à +70 %"],
              ["12 mois", "+80 à +120 %"],
              ["À vie", "+150 à +250 %"],
            ]}
          />
          <p>
            Deux cas reviennent souvent et se facturent au mois, pas au forfait : le whitelisting, quand la marque
            diffuse ses pubs depuis ton compte et sous ton nom, et les Spark Ads, quand elle sponsorise une publication
            que tu as déjà postée. Compte +25 à +35 % par mois, pour chacun. Six mois de whitelisting, ce n&apos;est pas
            +50 % : c&apos;est de l&apos;ordre de +150 %.
          </p>
          <p>
            Deux lignes plus rares, mais réellement facturées : les rushs bruts, si la marque veut tes fichiers source,
            +35 à +45 % ; et les variantes d&apos;accroche ou de CTA, 40 à 60 € l&apos;unité.
          </p>
          <p>Exclusivité — tu t&apos;interdis les marques concurrentes :</p>
          <RateTable
            head={["Durée", "À ajouter"]}
            rows={[
              ["1 mois", "+15 à +25 %"],
              ["3 mois", "+30 à +50 %"],
              ["6 mois et plus", "+60 à +90 %"],
            ]}
          />
          <p>
            Territoire monde : +20 à +30 %. Une marque qui vend en France et en Belgique ne paie pas les droits monde.
          </p>
          <p>
            Cession totale des droits — tu ne possèdes plus rien : +100 à +200 %. Ce n&apos;est plus une collaboration,
            c&apos;est une vente.
          </p>
          <p>
            Ces suppléments ne s&apos;additionnent pas à l&apos;infini. L&apos;ensemble des majorations est plafonné à
            +150 % du prix de création, et ce plafond ne monte à +250 % que si la marque demande l&apos;usage à vie ou
            la cession totale des droits. Si tu additionnes tout et que tu dépasses, c&apos;est le plafond qui
            s&apos;applique.
          </p>
        </Section>

        <Section title="Un exemple, en entier">
          <p>
            L&apos;offre : trois vidéos TikTok et une story, droits publicitaires six mois, exclusivité catégorie trois
            mois. Niveau «&nbsp;Je débute&nbsp;». La marque propose 300 € et des produits.
          </p>
          <ul className="flex flex-col gap-2">
            <li>
              Création : trois vidéos et une story, avec la dégressivité de volume, ça fait{" "}
              <strong className="font-semibold text-encre">300 à 540 €</strong>.
            </li>
            <li>
              Droits publicitaires six mois : +50 à +70 %, soit{" "}
              <strong className="font-semibold text-encre">150 à 378 €</strong> en plus.
            </li>
            <li>
              Exclusivité trois mois : +30 à +50 %, soit{" "}
              <strong className="font-semibold text-encre">90 à 270 €</strong> en plus.
            </li>
          </ul>
          <p className="font-display text-h3 font-bold text-encre">Total juste : entre 540 et 1 190 €.</p>
          <p>
            La marque en propose 300. Elle ne paie donc même pas la création seule — et elle repart avec six mois de
            publicité et trois mois pendant lesquels tu ne peux pas travailler avec ses concurrents.
          </p>
          <p>
            Ce n&apos;est pas forcément de la mauvaise foi. C&apos;est souvent quelqu&apos;un qui a un budget
            «&nbsp;influence&nbsp;» et qui n&apos;a jamais eu à séparer les lignes. Mais c&apos;est toi qui paies la
            différence.
          </p>
        </Section>

        <Section title="Ce qu'on ne sait pas chiffrer">
          <p>
            Autant le dire : certaines choses ne sont pas dans nos fourchettes, et on préfère l&apos;écrire que de te
            donner un chiffre inventé.
          </p>
          <p>
            Les journées de tournage, les déplacements, la location de matériel, les frais de production. Les supports
            en dehors des réseaux : une affiche en magasin, un spot télé, une page du site de la marque. Et l&apos;usage
            de ton contenu pour entraîner une IA — on le signale comme un problème, on ne sait pas encore le tarifer.
          </p>
          <p>Si l&apos;un de ces éléments est dans ton offre, ajoute-le à la main.</p>
        </Section>

        <Section title="Le vrai chiffre, c'est celui de ton offre">
          <p>
            Une grille te donne un ordre de grandeur. Elle ne sait pas que ta marque a écrit «&nbsp;droits
            d&apos;utilisation inclus&nbsp;» sans dire combien de temps, ni qu&apos;elle compte 40 % du{" "}
            {/* Seul lien vers le guide des produits offerts (mission #055) : aucun mot du texte n'a changé. */}
            <Link href="/produits-offerts" className="link">
              paiement en produits
            </Link>
            .
          </p>
          <p>
            Colle le message que tu as reçu. On te donne la fourchette pour ton offre précise et ce qui cloche dedans :
            c&apos;est gratuit et sans compte. La réponse à envoyer, mot pour mot, se débloque avec ton email.
          </p>
          <Button asChild size="lg" className="mt-1 h-12 w-full text-base sm:w-fit">
            <Link href="/analyse">Analyser mon deal</Link>
          </Button>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

// Même découpe que /droits-utilisation : un filet, un titre, le texte.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="measure flex flex-col gap-3 border-t border-filet pt-5">
      <h2 className="text-h2 font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

// Tableau de fourchettes : deux colonnes, lisible dès 320 px. La deuxième
// colonne est alignée à droite et ne se coupe pas (chiffres tabulaires).
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
