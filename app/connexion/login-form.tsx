"use client";

import { useActionState, useId } from "react";
import { requestMagicLink, type LoginState } from "@/app/connexion/actions";
import { track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const INITIAL: LoginState = { status: "idle", message: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(requestMagicLink, INITIAL);
  const emailId = useId();

  if (state.status === "sent") {
    return <LinkSent email={state.email ?? ""} next={next} />;
  }

  return (
    <form
      action={(formData) => {
        if (pending) return;
        track(ANALYTICS_EVENTS.emailSubmitted);
        return action(formData);
      }}
      aria-busy={pending}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="next" value={next} />
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
