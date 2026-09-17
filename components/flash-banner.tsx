"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { expiredFlashCookie, flashMessage, flashVisible, readFlash, type FlashKind } from "@/lib/auth/flash";

// Bandeau de confirmation après connexion ou déconnexion (mission #046).
//   - Pas de fenêtre modale : un bandeau dans le flux, en haut de page, qui ne
//     recouvre rien et ne bloque rien, avec un bouton pour le fermer.
//   - Lu une seule fois : le cookie éphémère est effacé dès la lecture.
//   - Rattaché à la page d'arrivée : il disparaît à la navigation suivante.
//   - Jamais d'adresse email.

type Latched = { kind: FlashKind; pathname: string } | null;

// Valeur lue une fois par chargement de page, gardée hors de React : le cookie
// est effacé juste après, et une relecture ne doit pas faire disparaître le bandeau.
let latched: Latched | undefined;

function readOnce(): Latched {
  if (latched === undefined) {
    const kind = readFlash(document.cookie);
    latched = kind ? { kind, pathname: window.location.pathname } : null;
  }
  return latched;
}

const noSubscription = () => () => undefined;

export function FlashBanner() {
  const flash = useSyncExternalStore(noSubscription, readOnce, () => null);
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (flash) document.cookie = expiredFlashCookie();
  }, [flash]);

  if (!flash || !flashVisible(flash, pathname, dismissed)) return null;
  const message = flashMessage(flash.kind, flash.pathname);
  return <FlashBannerView message={message} onClose={() => setDismissed(true)} />;
}

export function FlashBannerView({ message, onClose }: { message: ReturnType<typeof flashMessage>; onClose?: () => void }) {
  return (
    <div role="status" data-flash className="bg-encre text-creme">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-4 px-4 py-3 sm:px-6">
        <p className="text-small">
          <span className="font-semibold">{message.title}</span>
          {message.text ? <> {message.text}</> : null}
          {message.link ? (
            <>
              {" "}
              <Link href={message.link.href} className="font-semibold underline underline-offset-2">
                {message.link.label}
              </Link>
            </>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer ce message"
          className="-my-1 inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-creme/40"
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
