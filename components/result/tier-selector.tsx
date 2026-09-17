"use client";

import { createContext, useContext, useId } from "react";
import { TIER_COOKIE, TIER_COOKIE_MAX_AGE, TIER_LABEL, TIERS, type Tier } from "@/lib/rates/tier";
import { cn } from "@/lib/utils";

// Niveau affiché sur la page de résultat. Fourni par AnalysisResult à ce qui
// dépend du niveau hors des blocs de lecture : carte partageable et avis.
export const TierContext = createContext<Tier | null>(null);

export function useTier(): Tier | null {
  return useContext(TierContext);
}

// Mémorise le choix pour les analyses suivantes. Le recalcul, lui, a déjà eu
// lieu : rien ici n'est attendu pour afficher les nouveaux chiffres.
//   - cookie du navigateur, avec ou sans compte (lu par /api/analyse) ;
//   - compte connecté : /api/niveau, en arrière-plan, pour un autre appareil.
export function rememberTier(tier: Tier, toAccount: boolean) {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${TIER_COOKIE}=${tier}; Path=/; Max-Age=${TIER_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // cookies bloqués : le choix vaut pour cette page seulement
  }
  if (toAccount) {
    void fetch("/api/niveau", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
      keepalive: true,
    }).catch(() => undefined);
  }
}

// Trois choix, près de la fourchette. Changer de niveau recalcule la page dans
// le navigateur (lib/analysis/recompute.ts). changeable : faux pour une analyse
// calculée avec une table plus ancienne, où le niveau est seulement indiqué.
export function TierSelector({
  tier,
  changeable,
  onChange,
}: {
  tier: Tier;
  changeable: boolean;
  onChange: (tier: Tier) => void;
}) {
  const legendId = useId();
  if (!changeable) {
    return (
      <p id="niveau" className="scroll-mt-24 text-small text-attenue">
        Calculée au niveau « {TIER_LABEL[tier].title} », avec une ancienne table de tarifs : le niveau ne peut pas être
        changé sur cette analyse.
      </p>
    );
  }
  return (
    <fieldset id="niveau" className="flex scroll-mt-24 flex-col gap-3" aria-describedby={`${legendId}-aide`}>
      <legend id={legendId} className="mb-1 font-semibold text-encre">
        Ton niveau
      </legend>
      <p id={`${legendId}-aide`} className="text-small text-attenue">
        La fourchette dépend de ton expérience. Change de niveau : tout est recalculé ici, sans nouvelle analyse.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {TIERS.map((value) => {
          const selected = tier === value;
          return (
            <label
              key={value}
              data-tier={value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-control border-2 border-encre px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marque",
                selected ? "bg-encre text-creme" : "text-encre hover:bg-filet",
              )}
            >
              <input
                type="radio"
                name="niveau"
                value={value}
                checked={selected}
                onChange={() => onChange(value)}
                className="sr-only"
              />
              <span className="font-semibold">{TIER_LABEL[value].title}</span>
              {/* Chaîne simple et non cn() : tailwind-merge retirerait text-small face à la couleur. */}
              <span className={`text-small ${selected ? "text-creme" : "text-encre-douce"}`}>{TIER_LABEL[value].detail}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
