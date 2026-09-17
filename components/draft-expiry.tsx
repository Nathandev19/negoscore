"use client";

import { useEffect } from "react";
import { clearDraft, draftExpiresIn, pruneDraft, subscribeDraft } from "@/lib/draft";

// Expiration du brouillon d'offre (mission #062, D2). Il était seulement
// ignoré à la relecture : un brouillon de plus de 24 h restait dans le
// navigateur tant qu'on ne rouvrait pas le formulaire. Monté dans la mise en
// page, ce composant l'efface à chaque chargement de page, puis programme son
// effacement à l'échéance si l'onglet reste ouvert. Il n'affiche rien.
export function DraftExpiry() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pruneDraft();
      const left = draftExpiresIn();
      if (left === null) return;
      // setTimeout est borné à ~24,8 jours : 24 h tient largement dedans.
      timer = setTimeout(() => {
        clearDraft();
        timer = null;
      }, left);
    }

    schedule();
    // Un autre onglet vient d'écrire ou d'effacer le brouillon : on reprogramme.
    const unsubscribe = subscribeDraft(schedule);
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return null;
}
