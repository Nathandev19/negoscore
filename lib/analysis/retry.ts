import { RETRY_WINDOW_DAYS } from "@/lib/analysis/retry-window";
import { viewerOwnsDeal } from "@/lib/analysis/load";
import type { SessionUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/security/request";
import { isMissingColumn, isMissingRelation, selectRows, updateRows } from "@/lib/supabase/server";

// Relance gratuite d'une analyse incomplète (mission #043).
//
// Une analyse « incomplete » ne donne aucun chiffre et conseille d'aller
// demander à la marque ce qui manque. Elle a pourtant consommé un droit. Quand
// la personne revient avec la réponse, elle peut relancer l'analyse de la même
// offre depuis sa page de résultat, sans consommer de nouveau droit :
//   - une seule relance par analyse incomplète ;
//   - pendant RETRY_WINDOW_DAYS après l'analyse d'origine ;
//   - une relance ne se relance pas, même si elle ressort encore incomplète ;
//   - seulement par la personne qui a lancé l'analyse d'origine.
//
// La relance est « réservée » sur l'analyse d'origine (retried_at) AVANT l'appel
// au modèle, par une mise à jour conditionnelle : deux relances simultanées ne
// passent pas toutes les deux. Si l'analyse échoue (modèle, texte illisible),
// la réservation est levée : rien n'est consommé, comme pour un droit normal.
// retried_at reste posé si la relance est ensuite supprimée : supprimer la
// relance ne rouvre pas le droit.
//
// Aucun compteur de droits n'est touché (free_usage, crédits) ; les relances
// sont exclues du quota mensuel Pro (is_retry). Colonnes créées par la
// migration 20260917000018 ; sans elle, la relance n'est simplement pas proposée.

export { RETRY_WINDOW_DAYS };
const DAY_MS = 24 * 60 * 60 * 1000;

export type RetryRow = {
  created_at: string;
  retried_at: string | null;
  is_retry: boolean;
  evaluability: string | null;
};

export type RetryState =
  | { kind: "available"; until: Date }
  | { kind: "used" }
  | { kind: "expired" }
  | { kind: "retry_still_incomplete" }
  | { kind: "not_applicable" };

export function retryDeadline(createdAt: string): Date {
  return new Date(new Date(createdAt).getTime() + RETRY_WINDOW_DAYS * DAY_MS);
}

// Décision pure, sans base : testée seule.
export function decideRetry(row: RetryRow, now: Date = new Date()): RetryState {
  if (row.evaluability !== "incomplete") return { kind: "not_applicable" };
  if (row.is_retry) return { kind: "retry_still_incomplete" };
  if (row.retried_at !== null) return { kind: "used" };
  const until = retryDeadline(row.created_at);
  if (now.getTime() > until.getTime()) return { kind: "expired" };
  return { kind: "available", until };
}

function warnMissing(operation: string) {
  console.warn(
    JSON.stringify({
      event: "analysis_retry_missing",
      operation,
      detail: "Colonnes analyses.retried_at / is_retry / retry_of absentes : appliquer la migration 20260917000018.",
    }),
  );
}

const unavailable = (caught: unknown) => isMissingColumn(caught) || isMissingRelation(caught);

export type RetryPageState = RetryState & { retryId: string | null };

// État affiché sur la page de résultat. null : relance indisponible (migration
// absente), rien n'est affiché.
export async function retryStateFor(analysisId: string, now: Date = new Date()): Promise<RetryPageState | null> {
  try {
    const [row] = await selectRows<RetryRow>(
      "analyses",
      `select=created_at,retried_at,is_retry,evaluability:payload->>evaluability&id=eq.${analysisId}&limit=1`,
    );
    if (!row) return null;
    const state = decideRetry(row, now);
    let retryId: string | null = null;
    if (state.kind === "used") {
      const [child] = await selectRows<{ id: string }>("analyses", `select=id&retry_of=eq.${analysisId}&limit=1`);
      retryId = child?.id ?? null;
    }
    return { ...state, retryId };
  } catch (caught) {
    if (!unavailable(caught)) throw caught;
    warnMissing("read");
    return null;
  }
}

export type RetryClaim = {
  ok: true;
  originalId: string;
  // Marque lue dans l'offre d'origine, pour vérifier qu'il s'agit de la même offre.
  originalBrand: string | null;
  // Lève la réservation : l'analyse n'a pas abouti.
  release: () => Promise<void>;
};

export type RetryRefusal = { ok: false; status: number; reason: string; message: string };

export const RETRY_MESSAGES = {
  not_found: "Analyse d'origine introuvable. Lance une nouvelle analyse.",
  not_applicable: "Seule une analyse incomplète peut être relancée gratuitement.",
  used: "Cette analyse a déjà été relancée. Une nouvelle analyse consommera un droit.",
  retry_still_incomplete: "Cette analyse était déjà ta relance gratuite. Une nouvelle analyse consommera un droit.",
  expired: `La relance gratuite était possible pendant ${RETRY_WINDOW_DAYS} jours après l'analyse : ce délai est passé. Une nouvelle analyse consommera un droit.`,
  unavailable: "La relance gratuite est momentanément indisponible. Réessaie plus tard.",
  different_offer:
    "Ce texte ne semble pas concerner la même offre : la marque n'est pas celle de l'analyse d'origine. La relance gratuite ne s'applique pas.",
} as const;

type OriginalRow = RetryRow & { brand: string | null; deal: { anon_token: string | null; user_id: string | null } };

export async function claimRetry(
  originalId: unknown,
  viewer: { user: SessionUser | null; anonToken: string | null },
  now: Date = new Date(),
): Promise<RetryClaim | RetryRefusal> {
  const refuse = (status: number, reason: keyof typeof RETRY_MESSAGES): RetryRefusal => ({
    ok: false,
    status,
    reason: `retry_${reason}`,
    message: RETRY_MESSAGES[reason],
  });
  if (typeof originalId !== "string" || !isUuid(originalId)) return refuse(404, "not_found");
  try {
    const [row] = await selectRows<OriginalRow>(
      "analyses",
      `select=created_at,retried_at,is_retry,evaluability:payload->>evaluability,brand:payload->deal->>brand,deal:deals!inner(anon_token,user_id)&id=eq.${originalId}&limit=1`,
    );
    // Inexistante ou appartenant à quelqu'un d'autre : même réponse.
    if (!row || !viewerOwnsDeal(row.deal, viewer)) return refuse(404, "not_found");
    const state = decideRetry(row, now);
    if (state.kind !== "available") return refuse(state.kind === "not_applicable" ? 400 : 409, state.kind);

    const claimedAt = now.toISOString();
    const claimed = await updateRows<{ id: string }>(
      "analyses",
      `id=eq.${originalId}&retried_at=is.null&is_retry=is.false`,
      { retried_at: claimedAt },
    );
    // Prise entre-temps par une autre relance simultanée.
    if (claimed.length === 0) return refuse(409, "used");
    return {
      ok: true,
      originalId,
      originalBrand: row.brand,
      release: async () => {
        await updateRows("analyses", `id=eq.${originalId}&retried_at=eq.${encodeURIComponent(claimedAt)}`, { retried_at: null });
      },
    };
  } catch (caught) {
    if (!unavailable(caught)) throw caught;
    warnMissing("claim");
    return refuse(503, "unavailable");
  }
}

function normalizeBrand(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

// Même offre, au sens où on peut le vérifier sans relire le texte d'origine
// (effacé au bout de 30 jours) : si les deux analyses nomment une marque, ce
// doit être la même, à la casse, aux accents et à la ponctuation près, l'une
// pouvant contenir l'autre (« Ortie » et « Maison Ortie »). Une marque absente
// d'un côté ne prouve rien : l'offre d'origine était justement incomplète.
export function sameOffer(originalBrand: string | null, retryBrand: string | null): boolean {
  if (!originalBrand || !retryBrand) return true;
  const a = normalizeBrand(originalBrand);
  const b = normalizeBrand(retryBrand);
  if (a === "" || b === "") return true;
  return a.includes(b) || b.includes(a);
}
