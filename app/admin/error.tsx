"use client";

export default function AdminError({ reset }: { reset: () => void }) {
  return <main id="contenu" className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-4 px-4 py-16 sm:px-6">
    <h1 className="text-h1">Cockpit indisponible</h1>
    <p>Les données n’ont pas pu être chargées. Aucune mutation n’a été effectuée.</p>
    <button type="button" onClick={reset} className="rounded-control bg-encre px-4 py-2 font-semibold text-creme">Réessayer</button>
  </main>;
}
