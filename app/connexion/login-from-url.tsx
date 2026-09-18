"use client";

import { useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/auth/next-path";

// Ce que /connexion lit dans son adresse, dans le navigateur : la page reste
// statique. Chacun est isolé dans son propre <Suspense>, autour de rien
// d'autre : le formulaire, lui, garde toujours sa place (mission #074).

// Destination demandée (?next=), filtrée par la même règle que côté serveur.
// Absente de la page statique : sans JavaScript, l'action serveur la retrouve
// dans l'adresse de la page (app/connexion/actions.ts).
export function NextFromUrl() {
  const next = useSearchParams().get("next");
  return next === null ? null : <input type="hidden" name="next" value={safeNextPath(next)} />;
}

export const LINK_ERROR_MESSAGE = "Ce lien a expiré ou a déjà servi. Demande un nouveau lien.";

// Ancienne forme de l'erreur de lien (?erreur=lien). Les routes de connexion
// renvoient désormais vers /connexion/lien-expire, qui l'affiche sans
// JavaScript ; celle-ci reste lue pour une adresse encore en circulation.
export function LinkErrorFromUrl() {
  return useSearchParams().get("erreur") === "lien" ? <LinkError /> : null;
}

export function LinkError() {
  return (
    <p role="alert" className="alert-bad py-1 text-sm">
      {LINK_ERROR_MESSAGE}
    </p>
  );
}
