"use client";

import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "@/app/connexion/actions";
import { track } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const INITIAL: LoginState = { status: "idle", message: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(requestMagicLink, INITIAL);

  if (state.status === "sent") {
    return <LinkSent email={state.email ?? ""} next={next} />;
  }

  return (
    <form
      action={(formData) => {
        track(ANALYTICS_EVENTS.emailSubmitted);
        return action(formData);
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="next" value={next} />
      <Input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="ton@email.fr"
        aria-label="Ton email"
        className="h-12"
      />
      {state.status === "error" ? (
        <p role="alert" className="border-l border-encre py-1 pl-3 text-sm font-semibold text-encre">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="h-12 text-base">
        {pending ? "Envoi du lien…" : "Recevoir mon lien de connexion"}
      </Button>
    </form>
  );
}

// Attente du lien : c'est l'étape où l'on perd le plus de monde. On dit que le
// lien est parti, où, pour combien de temps, et quoi faire s'il n'arrive pas.
export function LinkSent({ email, next }: { email: string; next: string }) {
  return (
    <div role="status" className="flex flex-col gap-3 border-y border-encre py-5">
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
