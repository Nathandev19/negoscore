"use client";

import { Suspense, useActionState, useId, useRef, type FormEvent } from "react";
import { currentAttribution } from "@/components/analytics/first-party-view";
import { requestMagicLink, type LoginState } from "@/app/connexion/actions";
import { NextFromUrl } from "@/app/connexion/login-from-url";
import { safeNextPath } from "@/lib/auth/next-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const INITIAL: LoginState = { status: "idle", message: null };

// Formulaire de connexion (mission #074). L'action serveur est passée
// DIRECTEMENT au formulaire : le navigateur seul sait l'envoyer, sans le moindre
// fichier JavaScript. Avant, une fonction du navigateur s'intercalait pour la
// mesure d'audience, et le HTML servi était
//   <form action="javascript:throw new Error('React form unexpectedly submitted.')">
// — si le fichier ne se chargeait pas (réseau mobile qui décroche), rien ne
// partait, en silence.
//
// Sans JavaScript, l'envoi recharge la page : le serveur exécute l'action et
// rend CE composant avec son résultat (lien envoyé, ou message d'erreur). Pour
// que le résultat retrouve ce formulaire, il reste toujours à la même place dans
// l'arbre : rien de ce qui dépend de l'adresse n'est autour de lui.
export function LoginForm() {
  const [state, action, pending] = useActionState(requestMagicLink, INITIAL);
  const emailId = useId();
  // Mission #162 — l'attribution de la page courante, écrite dans un champ
  // caché à l'envoi, comme le fait déjà le formulaire de paiement. Elle ne dit
  // quelque chose que si /connexion elle-même porte des UTM ; le reste du
  // temps c'est le serveur qui retrouve l'origine par le jeton anonyme
  // (app/connexion/actions.ts). Sans JavaScript, ce champ reste vide, et une
  // inscription non attribuée vaut mieux qu'une origine inventée.
  const attributionField = useRef<HTMLInputElement>(null);

  if (state.status === "sent") {
    return <LinkSent email={state.email ?? ""} next={state.next ?? safeNextPath(null)} />;
  }

  // Au moment de l'envoi : mesure d'audience. Elle ne peut JAMAIS empêcher
  // l'envoi : une erreur est avalée, et sans JavaScript elle n'existe pas.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    try {
      if (attributionField.current) attributionField.current.value = JSON.stringify(currentAttribution());
    } catch {
      // mesure indisponible : la connexion passe avant
    }
  }

  return (
    <form action={action} onSubmit={onSubmit} aria-busy={pending} className="flex flex-col gap-3">
      {/* Destination lue dans l'adresse, dans le navigateur (la page est
          statique). Sans JavaScript, ce champ n'existe pas : l'action la
          reprend dans l'adresse de la page qui envoie (actions.ts). */}
      <Suspense fallback={null}>
        <NextFromUrl />
      </Suspense>
      {/* Mission #162 — rempli à l'envoi, jamais au rendu : la page est
          statique, et une valeur figée au build ne dirait rien de la visite. */}
      <input type="hidden" name="attribution" ref={attributionField} defaultValue="" />
      {/* Étiquette visible : elle reste là quand le champ est rempli, ce que
          l'exemple dans le champ ne fait pas (mission #062, A7). */}
      <label htmlFor={emailId} className="text-small font-semibold text-encre">
        Ton email
      </label>
      <Input
        id={emailId}
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="ton@email.fr"
        className="h-12"
      />
      {state.status === "error" ? (
        <p role="alert" className="alert-bad py-1 text-sm">
          {state.message}
        </p>
      ) : null}
      {/* Occupé : le bouton reste dans l'ordre de tabulation et l'annonce,
          au lieu de disparaître du clavier (mission #062, A12). */}
      <Button type="submit" size="lg" aria-busy={pending} aria-disabled={pending} className="h-12 text-base">
        {pending ? "Envoi du lien…" : "Recevoir mon lien de connexion"}
      </Button>
    </form>
  );
}

// Attente du lien : c'est l'étape où l'on perd le plus de monde. On dit que le
// lien est parti, où, pour combien de temps, et quoi faire s'il n'arrive pas.
export function LinkSent({ email, next }: { email: string; next: string }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-control border-2 border-encre p-5">
      <p className="font-display text-h2 font-bold text-encre">Regarde ta boîte mail</p>
      <p className="text-base">
        Lien envoyé à <span className="font-semibold break-all">{email}</span>. Ouvre-le pour te connecter : il est valable
        une heure.
      </p>
      <p className="text-sm">
        Rien après une minute ? Regarde dans tes spams ou tes promotions, et vérifie l&apos;adresse.
      </p>
      <a
        href={`/connexion?next=${encodeURIComponent(next)}`}
        className="link w-fit text-sm font-semibold"
      >
        Utiliser une autre adresse
      </a>
    </div>
  );
}
