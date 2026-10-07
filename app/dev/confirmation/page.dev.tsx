"use client";

import { useState } from "react";
import { ConfirmationAdmin, type DemandeAdmin } from "@/components/admin/user-actions";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx) : /dev/confirmation
//
// Mission #159, point 4 — la modale de confirmation admin existe depuis la
// #145, et les deux actions passent déjà par elle. Ce qui manquait, c'est un
// moyen DE L'OUVRIR sans compte propriétaire ni base : les deux défauts trouvés
// en l'ouvrant à l'époque — Échap qui ne fermait pas, et la boîte qui sortait
// de l'écran à 320 px — étaient tous les deux invisibles depuis les tests, qui
// passaient pendant qu'ils étaient là.
//
// Cette page sert donc à REGARDER. Les trois demandes couvrent les trois
// récapitulatifs possibles, avec un email et un motif volontairement longs :
// c'est ce contenu-là qui faisait déborder la boîte.
const DEMANDES: Array<{ cle: string; libelle: string; demande: DemandeAdmin; email: string | null }> = [
  {
    cle: "grant",
    libelle: "Accorder Pro offert (avec date de fin)",
    demande: {
      kind: "entitlement",
      action: "grant",
      reason: "Compensation après l'incident d'analyse du 3 octobre : deux négociations perdues, signalées par email.",
      expiresAt: "2026-12-31T23:30",
    },
    email: "une-creatrice-au-tres-long-email@exemple-de-domaine-assez-long.test",
  },
  {
    cle: "revoke",
    libelle: "Retirer l'accès Pro offert",
    demande: { kind: "entitlement", action: "revoke", reason: "Fin de la période de compensation convenue.", expiresAt: null },
    email: "une-creatrice-au-tres-long-email@exemple-de-domaine-assez-long.test",
  },
  {
    cle: "credits",
    libelle: "Ajuster les crédits",
    demande: {
      kind: "credits",
      delta: -2,
      reason: "Deux négociations décomptées deux fois le 3 octobre, confirmées dans l'audit : remise à l'état attendu.",
    },
    email: null,
  },
];

export default function ConfirmationPreviewPage() {
  const [ouverte, setOuverte] = useState<string | null>(null);
  const courante = DEMANDES.find((entry) => entry.cle === ouverte);
  return (
    <main id="contenu" className="flex min-h-screen flex-col gap-4 px-4 py-8 sm:px-6">
      <h1 className="text-h2">Modale de confirmation admin</h1>
      <p className="text-small text-attenue">
        À ouvrir à 320 px de large et à 412 px : la boîte doit rester entièrement visible, et Échap doit la fermer.
      </p>
      {DEMANDES.map((entry) => (
        <button
          key={entry.cle}
          type="button"
          onClick={() => setOuverte(entry.cle)}
          className="rounded-control border-2 border-encre px-4 py-2 text-left font-semibold text-encre"
        >
          {entry.libelle}
        </button>
      ))}
      {courante ? (
        <ConfirmationAdmin
          demande={courante.demande}
          email={courante.email}
          onAnnuler={() => setOuverte(null)}
          onConfirmer={() => setOuverte(null)}
        />
      ) : null}
    </main>
  );
}
