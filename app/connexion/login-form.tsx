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
        className="h-12 bg-white text-base md:text-base"
      />
      {state.status === "error" ? (
        <p role="alert" className="text-sm font-medium text-red-700">
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
    <div role="status" className="flex flex-col gap-3 rounded-xl border bg-white p-4">
      <p className="text-lg font-bold">Regarde ta boîte mail</p>
      <p className="text-base">
        Lien envoyé à <span className="font-semibold break-all">{email}</span>. Ouvre-le pour te connecter : il est valable
        une heure.
      </p>
      <p className="text-sm text-neutral-700">
        Rien après une minute ? Regarde dans tes spams ou tes promotions, et vérifie l&apos;adresse.
      </p>
      <a
        href={`/connexion?next=${encodeURIComponent(next)}`}
        className="text-sm font-medium text-neutral-950 underline underline-offset-4"
      >
        Utiliser une autre adresse
      </a>
    </div>
  );
}
