"use client";

import { createContext, useContext, useId } from "react";
import { hasSessionHint } from "@/lib/auth/session-hint";
import { encodeTierCookie, TIER_COOKIE, TIER_COOKIE_MAX_AGE, TIER_LABEL, TIERS, type Tier } from "@/lib/rates/tier";
import { cn } from "@/lib/utils";

// Niveau affiché sur la page de résultat. Fourni par AnalysisResult à ce qui
// dépend du niveau hors des blocs de lecture : carte partageable et avis.
export const TierContext = createContext<Tier | null>(null);

export function useTier(): Tier | null {
  return useContext(TierContext);
}

// Mémorise le choix pour les analyses suivantes. Le recalcul, lui, a déjà eu
// lieu : rien ici n'est attendu pour afficher les nouveaux chiffres.
//   - cookie du navigateur, avec ou sans compte (lu par /api/analyse), avec le
//     moment du choix : c'est le plus récent, cookie ou compte, qui gagne ;
//   - personne connectée : /api/niveau, en arrière-plan, pour un autre
//     appareil. Quelle que soit l'analyse ouverte, à elle ou non, verrouillée
//     ou non : le niveau est une préférence de personne (mission #065).
// Un échec de l'envoi n'est pas montré : le cookie reste la référence, et la
// prochaine analyse rattrape le compte (lib/rates/tier-preference.ts).
export function rememberTier(tier: Tier, now: number = Date.now()) {
  let signedIn = false;
  try {
    // Lu AVANT l'écriture du cookie de niveau.
    signedIn = hasSessionHint(document.cookie);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${TIER_COOKIE}=${encodeTierCookie(tier, now)}; Path=/; Max-Age=${TIER_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // cookies bloqués : le choix vaut pour cette page seulement
  }
  if (!signedIn) return;
  const warn = (reason: string) =>
    console.warn(JSON.stringify({ event: "rate_tier_save_failed", reason }));
  void fetch("/api/niveau", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier, at: now }),
    keepalive: true,
  })
    .then((response) => {
      if (!response.ok) warn(`HTTP ${response.status}`);
    })
    .catch(() => warn("réseau"));
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
    <fieldset id="niveau" className="flex scroll-mt-24 flex-col gap-3" aria-describedby={`${legendId}-aide ${legendId}-portee`}>
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
      {/* Ce que fait le choix, dit une fois (mission #065) : sans cette phrase,
          une analyse qui se rouvre sur son niveau d'origine passe pour un bug. */}
      <p id={`${legendId}-portee`} data-tier-scope className="text-small text-attenue">
        Change de niveau pour voir ce que ça donne. Ton choix s&apos;appliquera à tes prochaines analyses.
      </p>
    </fieldset>
  );
}
