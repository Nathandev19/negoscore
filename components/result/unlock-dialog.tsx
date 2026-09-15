"use client";

import { useState } from "react";
import { LockOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function UnlockDialog() {
  const [email, setEmail] = useState("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="lg" className="h-14 w-full text-lg">
          <LockOpenIcon className="size-5" />
          Débloquer — ton email suffit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Débloque ta contre-offre et ton message</DialogTitle>
          <DialogDescription>
            Ton email suffit. Pas de mot de passe, pas de carte bancaire.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            console.log("unlock-email", email);
          }}
        >
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="ton@email.fr"
            aria-label="Ton email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 text-base md:text-base"
          />
          <Button type="submit" size="lg" className="h-12 text-base">
            Débloquer
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
