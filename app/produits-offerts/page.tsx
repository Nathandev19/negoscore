import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { WRITTEN_CONTRACT_THRESHOLD_EUR } from "@/lib/legal/fr";
import { formatEur } from "@/lib/money";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/produits-offerts");

// Page publique statique (mission #055), même gabarit que les deux autres
// guides. Texte fourni par l'éditeur, repris au mot près : seul le balisage
// est de nous.
export default function GiftedProductsPage() {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 font-extrabold">Une marque te propose des produits gratuits</h1>
          <blockquote className="measure border-l-4 border-encre py-1 pl-4 text-encre italic">
            «&nbsp;On adore ton profil ! On t&apos;envoie notre routine complète, d&apos;une valeur de 120 €, en échange
            de deux vidéos.&nbsp;»
          </blockquote>
          <p className="measure">
            C&apos;est souvent le premier message qu&apos;on reçoit. Il est flatteur, il a l&apos;air gentil, et il pose
            une vraie question : est-ce que ça vaut le coup, ou est-ce que tu viens de travailler gratuitement ?
          </p>
          <p className="measure">
            La réponse n&apos;est pas toujours non. Mais elle dépend de trois choses, et le message ne t&apos;en donne
            aucune.
          </p>
        </div>

        <Section title="Ce n'est pas un cadeau">
          <p>
            Dès qu&apos;il y a une contrepartie attendue — une vidéo, une story, une mention — le produit n&apos;est
            plus un cadeau. C&apos;est un paiement en nature, dans une relation commerciale. La loi du 9 juin 2023 sur
            l&apos;influence commerciale encadre ces partenariats, et impose un contrat écrit dès que la collaboration
            dépasse {formatEur(WRITTEN_CONTRACT_THRESHOLD_EUR)}&nbsp;HT cumulés sur l&apos;année civile entre une même
            marque et un même créateur, avantages en nature inclus. En dessous, l&apos;écrit n&apos;est pas obligatoire — mais rien ne t&apos;empêche de le
            demander.
          </p>
          <p>Ça a deux conséquences.</p>
          <p>
            La première : tu as le droit de négocier. On ne négocie pas un cadeau, mais on négocie un paiement, et
            c&apos;en est un.
          </p>
          <p>
            La seconde : ça se déclare. Un produit reçu en échange d&apos;une prestation entre dans tes revenus
            professionnels, même si tu n&apos;as encaissé aucun euro. Ce n&apos;est pas une subtilité
            d&apos;expert-comptable, c&apos;est le principe de base. Si tu en reçois régulièrement, parles-en à un
            comptable : la manière de les valoriser mérite un avis que nous ne pouvons pas te donner.
          </p>
        </Section>

        <Section title="Un produit à 120 €, ça ne vaut pas 120 € pour toi">
          <p>
            Le prix affiché, c&apos;est ce que paierait un client. Ce n&apos;est pas ce que le produit te rapporte, et
            ce n&apos;est pas non plus ce qu&apos;il coûte à la marque.
          </p>
          <p>
            Pour toi : tu ne peux pas payer un loyer avec une routine de soins. Tu peux la revendre, mais rarement à son
            prix, et parfois pas du tout.
          </p>
          <p>
            Pour la marque : elle paie son coût de fabrication, pas le prix en rayon. Selon les secteurs, l&apos;écart
            est considérable — c&apos;est précisément pour ça que payer en produits est intéressant pour elle.
          </p>
          <p>
            Donc quand tu évalues l&apos;offre, compte le produit à ce qu&apos;il te rapporte vraiment, pas au chiffre
            écrit dans le message.
          </p>
        </Section>

        <Section title="Quand ça peut valoir le coup">
          <p>
            Il y a des cas où accepter est un bon calcul, et ce n&apos;est pas honteux de les prendre. Tous ces critères
            doivent être réunis :
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>Le produit est cher, et tu l&apos;aurais acheté de toute façon.</li>
            <li>Il n&apos;y a qu&apos;un seul livrable, ou deux.</li>
            <li>La vidéo reste sur ton compte, en organique.</li>
            <li>La marque ne demande ni droits publicitaires, ni exclusivité.</li>
            <li>Il n&apos;y a pas de brief de trois pages ni de date de rendu serrée.</li>
          </ul>
          <p>
            Autrement dit : quand ce n&apos;est pas vraiment du travail. Une vidéo que tu aurais pu faire de toi-même,
            sur un produit que tu voulais.
          </p>
        </Section>

        <Section title="Quand ça ne vaut jamais le coup">
          <p>Dès qu&apos;un seul de ces éléments apparaît, les produits ne suffisent plus :</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              La marque veut passer ta vidéo en publicité. Là, elle achète de la diffusion, et{" "}
              {/* Seul lien vers le guide des tarifs (mission #055) : aucun mot du texte n'a changé. */}
              <Link href="/combien-facturer" className="link">
                la diffusion se paie en euros
              </Link>
              .
            </li>
            <li>
              Elle demande une exclusivité, même courte. Tu lui vends des clients que tu n&apos;auras pas.
            </li>
            <li>
              Elle demande plusieurs vidéos, un brief précis, des retouches, une deadline. C&apos;est une prestation.
            </li>
            <li>
              Elle propose «&nbsp;des produits et de la visibilité&nbsp;». La visibilité n&apos;est pas une monnaie. Ton
              compte est déjà à toi.
            </li>
          </ul>
        </Section>

        <Section title="Quoi répondre">
          <p>
            Tu n&apos;as pas besoin de refuser sèchement. La bonne réponse ouvre la négociation au lieu de la fermer :
          </p>
          <blockquote className="measure rounded-control border-2 border-filet p-4 text-encre">
            «&nbsp;Merci beaucoup ! Le produit m&apos;intéresse. Pour ce format-là, je travaille avec une rémunération,
            et je peux inclure les produits dans l&apos;accord. Tu peux me dire si les vidéos restent sur mon compte ou
            si vous comptez les passer en pub, et sur quelle durée ? Je te fais une proposition juste après.&nbsp;»
          </blockquote>
          <p>
            Tu n&apos;as rien refusé, tu as juste dit que ton travail a un prix et demandé l&apos;information qui
            manquait. Une marque qui a un budget te le dira. Une marque qui n&apos;en a pas te le dira aussi, et tu
            sauras à quoi t&apos;en tenir.
          </p>
        </Section>

        <Section title="Vérifie ce qu'on te propose">
          <p>
            Colle le message tel que tu l&apos;as reçu, avec la valeur des produits annoncée. On te dit ce que
            l&apos;offre vaut en euros et ce qu&apos;elle demande vraiment : c&apos;est gratuit et sans compte. La
            réponse à envoyer, mot pour mot, se débloque avec ton email.
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

// Même découpe que les deux autres guides : un filet, un titre, le texte.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="measure flex flex-col gap-3 border-t border-filet pt-5">
      <h2 className="text-h2 font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
