"use client";

import { useSearchParams } from "next/navigation";
import { LoginForm } from "@/app/connexion/login-form";
import { safeNextPath } from "@/lib/auth/next-path";

// Paramètres de /connexion lus dans le navigateur : la page reste statique.
// next est filtré par la même règle que côté serveur (chemin interne seulement),
// et l'action d'envoi du lien le refiltre de toute façon.
export function LoginFromUrl() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const linkError = params.get("erreur") === "lien";
  return (
    <>
      {linkError ? (
        <p role="alert" className="alert-bad py-1 text-sm">
          Ce lien a expiré ou a déjà servi. Demande un nouveau lien.
        </p>
      ) : null}
      <LoginForm next={next} />
    </>
  );
}
