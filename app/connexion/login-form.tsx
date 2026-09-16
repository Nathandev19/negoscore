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
    return (
      <p role="status" className="rounded-xl border bg-white p-4 text-base font-medium">
        {state.message}
      </p>
    );
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
