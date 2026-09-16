import type { Metadata } from "next";
import { Facts, LegalPage, LegalSection, ToFill } from "@/components/legal/legal-page";
import { CONSENT_TEXT } from "@/lib/billing/consent";
import { PLANS } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "CGV" };

export default function TermsPage() {
  return (
    <LegalPage title="Conditions générales de vente" updated="16 septembre 2026">
      <LegalSection title="Objet">
        <Facts
          items={[
            "Le service analyse une offre de collaboration reçue par un créateur : score, points à négocier, fourchette de prix estimée, contre-offre et message prêt à envoyer.",
            "L'analyse est éducative et fondée sur des benchmarks de marché. Ce n'est pas un conseil juridique.",
          ]}
        />
        <ToFill>{"identité du vendeur, telle qu'elle figure aux mentions légales"}</ToFill>
      </LegalSection>

      <LegalSection title="Les offres et leurs prix">
        <ul className="flex flex-col gap-3">
          {PLANS.map((plan) => (
            <li key={plan.id} className="rounded-xl border bg-white p-4">
              <p className="font-bold">
                {plan.name} — {plan.price}
                {plan.period ? ` ${plan.period}` : ""}
              </p>
              <p className="text-sm text-neutral-700">{plan.summary}</p>
            </li>
          ))}
        </ul>
        <Facts
          items={[
            "Prix affichés en euros, toutes taxes comprises.",
            "Pack Deal : achat unique, les crédits s'ajoutent au solde existant.",
            "Pro : abonnement mensuel, jusqu'à 30 analyses par période, résiliable depuis l'espace de gestion Whop.",
          ]}
        />
        <ToFill>{"TVA applicable et mention de franchise en base si elle s'applique"}</ToFill>
      </LegalSection>

      <LegalSection title="Paiement">
        <Facts
          items={[
            "Le paiement est opéré par Whop, qui encaisse pour le compte du vendeur et fournit le reçu.",
            "Aucune donnée de carte bancaire ne transite par le service ni n'est conservée par lui.",
            "Les crédits sont ajoutés au compte dès la confirmation du paiement par Whop.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Fourniture du service">
        <Facts
          items={[
            "Le service numérique est fourni immédiatement après le paiement : les crédits sont utilisables tout de suite.",
            "Une analyse qui échoue ne consomme aucun crédit.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Droit de rétractation">
        <ToFill>
          clause de renonciation au droit de rétractation. Deux conditions cumulatives sont exigées : accord exprès du
          consommateur pour que l&apos;exécution commence avant la fin du délai de 14 jours, ET renoncement exprès à son
          droit de rétractation. Une seule des deux ne suffit pas. À rédiger sur la base de service-public.gouv.fr et du
          code de la consommation
        </ToFill>
        <p className="text-sm text-neutral-700">
          Case affichée au moment du paiement, non pré-cochée, dont l&apos;état et la date sont enregistrés côté serveur.
          Son texte actuel :
        </p>
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          {CONSENT_TEXT}
        </p>
      </LegalSection>

      <LegalSection title="Remboursements">
        <ToFill>conditions de remboursement : cas ouverts, délai de demande, délai de traitement</ToFill>
      </LegalSection>

      <LegalSection title="Réclamations et médiation">
        <ToFill>
          nom et coordonnées du médiateur de la consommation, et adresse email de réclamation avant saisine
        </ToFill>
      </LegalSection>

      <LegalSection title="Droit applicable">
        <ToFill>droit applicable et juridiction compétente</ToFill>
      </LegalSection>
    </LegalPage>
  );
}
