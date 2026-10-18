"use client";

import { useElapsed, WaitingPanel } from "@/components/loading-steps";
import { CONCLUSION_PENDING_ID, THREAD_ERROR_ID, THREAD_PENDING_ID } from "@/lib/ui/reveal";

// Mission #096, défaut 3 — l'attente et l'échec s'affichent LÀ où la réponse
// va apparaître : sous le dernier tour, au-dessus du formulaire. Les deux
// portent un identifiant et prennent le focus, pour être amenés en vue et
// annoncés (lib/ui/reveal.ts).

// Le libellé de l'unique étape. Il dit ce que le serveur fait vraiment
// pendant que le navigateur attend : il lit la réponse de la marque.
export const THREAD_READING_LABEL = "Lecture de la réponse de la marque";

// Mission #200 — L'ATTENTE D'UN TOUR EMPLOIE LE PANNEAU DE LA PREMIÈRE
// ANALYSE, avec une seule étape.
//
// Ce qui existait ici était une note à filet : juste, mais sans rien qui
// bouge et sans le temps écoulé, alors que la première analyse a un panneau
// encadré, une étape qui tourne et un compteur. À l'usage, la différence se
// lit comme « il ne se passe rien ».
//
// UNE SEULE ÉTAPE, et c'est un choix. Le serveur appelle le modèle puis fait
// tout le reste — ce qui est accordé, refusé, laissé sans réponse, le
// recalcul, le message suivant — dans la MÊME requête, sans rien remonter
// entre-temps. Le navigateur ne sait qu'une chose : la réponse est arrivée ou
// non. Afficher quatre étapes qui se cochent serait joli et faux.
export function ThreadPending({ turnNumber, startedAt }: { turnNumber: number; startedAt?: number }) {
  // À défaut de départ fourni, celui du montage : le panneau apparaît au clic,
  // les deux ne diffèrent que d'un rendu.
  const { now, startedAt: monte } = useElapsed();
  const depart = startedAt ?? monte;
  return (
    <WaitingPanel
      id={THREAD_PENDING_ID}
      role="status"
      title="On lit la réponse de la marque"
      label={THREAD_READING_LABEL}
      steps={[]}
      checked={0}
      running
      elapsedMs={Math.max(0, now - depart)}
      className="scroll-mt-24"
      footer={
        <p className="text-small text-attenue">
          Ça peut prendre jusqu&apos;à une minute. Le tour {turnNumber} s&apos;affichera ici, et la page t&apos;y amènera.
        </p>
      }
    />
  );
}

// Mission #201, chantier B — « J'ACCEPTE CES TERMES » ATTENDAIT À VIDE.
//
// Le bouton changeait de texte, et c'était tout : pas de panneau, pas de
// compteur, et le récapitulatif apparaissait plus bas sans que rien n'ait
// annoncé qu'il arrivait. Même traitement que le tour, donc, au mot près.
//
// MAIS PAS LE MÊME LIBELLÉ, et c'est la règle d'honnêteté de la mission #200
// appliquée telle quelle : la conclusion N'APPELLE PAS LE MODÈLE. Elle est
// écrite par le code (lib/negotiation/conclusion.ts) à partir de ce qui est
// déjà convenu. Annoncer « lecture » serait faux ; elle annonce ce qu'elle
// fait, et elle le fait vite.
export const CONCLUSION_LABEL = "Récapitulatif de ce qui est convenu";

export function ConclusionPending({ startedAt }: { startedAt?: number }) {
  const { now, startedAt: monte } = useElapsed();
  const depart = startedAt ?? monte;
  return (
    <WaitingPanel
      id={CONCLUSION_PENDING_ID}
      role="status"
      title="On prépare la conclusion"
      label={CONCLUSION_LABEL}
      steps={[]}
      checked={0}
      running
      elapsedMs={Math.max(0, now - depart)}
      className="scroll-mt-24"
      footer={
        <p className="text-small text-attenue">
          C&apos;est rapide : rien n&apos;est relu, l&apos;outil rassemble ce qui est déjà convenu et prépare le message qui
          demande une confirmation écrite. Il s&apos;affichera ici.
        </p>
      }
    />
  );
}

export function ThreadError({ message }: { message: string }) {
  return (
    <div id={THREAD_ERROR_ID} tabIndex={-1} role="alert" className="flex scroll-mt-24 flex-col gap-1 alert-bad py-1 text-small">
      <p>{message}</p>
    </div>
  );
}
