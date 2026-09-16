import type { SessionUser } from "@/lib/auth/session";
import { selectRows } from "@/lib/supabase/server";

// Retrouve l'abonnement Whop d'un compte. L'identifiant d'abonnement n'est
// pas stocké dans une colonne dédiée : il est relu dans l'événement
// membership.activated déjà enregistré, par les metadata du checkout ou, à
// défaut, par l'email de l'acheteur.

type EventRow = { event_id: string; payload: { data?: { id?: string; plan?: { id?: string } } } };

async function latestActivation(filter: string): Promise<string | null> {
  const rows = await selectRows<EventRow>(
    "whop_events",
    `select=event_id,payload&type=eq.membership.activated&${filter}&order=event_id.desc&limit=5`,
  );
  const planId = process.env.WHOP_PLAN_PRO;
  for (const row of rows) {
    const data = row.payload?.data;
    if (data?.id && (!planId || data.plan?.id === planId)) return data.id;
  }
  return null;
}

export async function findMembershipId(user: SessionUser): Promise<string | null> {
  const byMetadata = await latestActivation(`payload->data->metadata->>user_id=eq.${encodeURIComponent(user.id)}`);
  if (byMetadata) return byMetadata;
  if (!user.email) return null;
  return latestActivation(`payload->data->user->>email=ilike.${encodeURIComponent(user.email)}`);
}
