import { THREAD_ERROR_ID, THREAD_PENDING_ID } from "@/lib/ui/reveal";

// Mission #096, défaut 3 — l'attente et l'échec s'affichent LÀ où la réponse
// va apparaître : sous le dernier tour, au-dessus du formulaire. Les deux
// portent un identifiant et prennent le focus, pour être amenés en vue et
// annoncés (lib/ui/reveal.ts).

export function ThreadPending({ turnNumber }: { turnNumber: number }) {
  return (
    <div
      id={THREAD_PENDING_ID}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="flex scroll-mt-24 flex-col gap-1 border-l-4 border-encre py-2 pl-4"
    >
      <p className="font-semibold text-encre">Lecture de la réponse de la marque…</p>
      <p className="text-small">
        Ça peut prendre jusqu&apos;à une minute. Le tour {turnNumber} s&apos;affichera ici, et la page t&apos;y amènera.
      </p>
    </div>
  );
}

export function ThreadError({ message }: { message: string }) {
  return (
    <div id={THREAD_ERROR_ID} tabIndex={-1} role="alert" className="flex scroll-mt-24 flex-col gap-1 alert-bad py-1 text-small">
      <p>{message}</p>
    </div>
  );
}
