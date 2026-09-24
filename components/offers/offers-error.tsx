"use client";

import { useSearchParams } from "next/navigation";

const ERRORS: Record<string, string> = {
  consentement: "Coche la case avant de continuer vers le paiement.",
  formule: "Cette formule n'existe pas.",
  indisponible: "Le paiement n'est pas disponible pour le moment. Réessaie dans quelques minutes.",
  // Mission #112 — la page de paiement n'a pas pu être créée AVEC ton compte.
  // On ne t'envoie pas payer « quand même » : un paiement qu'on ne saurait pas
  // rattacher à ton compte ne doit pas avoir lieu. Rien n'a été débité.
  session: "On n'a pas pu ouvrir le paiement rattaché à ton compte. Rien n'a été débité : réessaie dans un instant.",
  deja_pro: "Ton abonnement Pro est déjà en cours : inutile de le reprendre.",
};

// ?erreur= renvoyé par /api/checkout, lu dans le navigateur : /tarifs reste statique.
export function OffersError() {
  const code = useSearchParams().get("erreur");
  const error = code ? ERRORS[code] : undefined;
  if (!error) return null;
  return (
    <p role="alert" className="alert-bad py-1 text-sm">
      {error}
    </p>
  );
}
