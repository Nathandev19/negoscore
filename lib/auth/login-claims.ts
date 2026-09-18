import { createHash, randomBytes } from "node:crypto";
import { deleteRowsReturning, insertRow, isMissingRelation } from "@/lib/supabase/server";

// Réclamation d'analyses anonymes au moment de la connexion (mission #067).
//
// Le problème : le rattachement d'une analyse faite sans compte dépendait du
// cookie anonyme présent au CLIC sur le lien. Ouvert dans un autre navigateur,
// le lien connectait la personne mais laissait l'analyse anonyme (404).
//
// Le principe : le droit de récupérer les analyses est établi quand la personne
// DEMANDE le lien, dans le navigateur qui porte son jeton anonyme, et il n'est
// exerçable que par le lien envoyé à l'adresse demandée.
//
// Ce qui garantit qu'un identifiant d'analyse ne suffit jamais :
//   1. aucune entrée ici ne reçoit d'identifiant d'analyse. Le jeton rattaché
//      est lu par le serveur dans le cookie httpOnly de la demande ; seul celui
//      qui détient ce cookie peut créer une réclamation ;
//   2. l'utiliser exige les trois à la fois : une session vérifiée par Supabase
//      pour l'adresse exacte de la réclamation (preuve qu'on reçoit ses emails),
//      le secret aléatoire glissé dans le lien envoyé à cette adresse (stocké
//      seulement sous forme d'empreinte), et une réclamation encore valable ;
//   3. elle ne sert qu'une fois (supprimée en étant lue) ;
//   4. le rattachement lui-même refuse un jeton dont un deal appartient déjà à
//      un autre compte (lib/auth/account.ts, attachAnonDeals).

// Durée de validité : le double de celle du lien de connexion (une heure,
// réglage « Email OTP Expiration » de Supabase, lib/email/auth-templates.ts).
// Au-delà, le lien qui porte le secret ne peut plus ouvrir de session : la
// réclamation ne servirait plus à rien. À changer avec ce réglage.
export const LOGIN_CLAIM_TTL_MINUTES = 120;

// Nom du paramètre qui porte le secret dans le lien de connexion.
export const CLAIM_PARAM = "reclamation";

// 24 octets aléatoires, en base64url : 32 caractères.
const NONCE = /^[A-Za-z0-9_-]{32}$/;

function digest(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

// Enregistre la réclamation et renvoie le secret à glisser dans le lien. null :
// rien d'enregistré (table absente, base injoignable) — la connexion se fait
// quand même, avec l'ancien comportement (cookie présent au clic).
export async function createLoginClaim(email: string, anonToken: string, now: Date = new Date()): Promise<string | null> {
  const nonce = randomBytes(24).toString("base64url");
  try {
    await insertRow("login_claims", {
      email: email.trim().toLowerCase(),
      anon_token: anonToken,
      nonce_hash: digest(nonce),
      expires_at: new Date(now.getTime() + LOGIN_CLAIM_TTL_MINUTES * 60_000).toISOString(),
    });
    return nonce;
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "login_claim_error",
        operation: "create",
        reason: isMissingRelation(caught) ? "table login_claims absente : appliquer la migration 20260918000021" : "écriture",
      }),
    );
    return null;
  }
}

// Utilise la réclamation : renvoie le jeton anonyme à rattacher, ou null. La
// suppression filtrée EST la vérification : secret, adresse et date doivent
// correspondre tous les trois, et une ligne supprimée ne peut plus resservir.
export async function redeemLoginClaim(nonce: string | null, email: string | null, now: Date = new Date()): Promise<string | null> {
  if (!nonce || !NONCE.test(nonce) || !email) return null;
  try {
    const tokens = await deleteRowsReturning(
      "login_claims",
      `nonce_hash=eq.${digest(nonce)}&email=eq.${encodeURIComponent(email.trim().toLowerCase())}&expires_at=gt.${encodeURIComponent(now.toISOString())}`,
      "anon_token",
    );
    return tokens[0] ?? null;
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "login_claim_error",
        operation: "redeem",
        reason: isMissingRelation(caught) ? "table login_claims absente" : "lecture",
      }),
    );
    return null;
  }
}

// Le secret, lu dans l'adresse du lien. Deux formes selon la façon dont
// Supabase insère {{ .RedirectTo }} dans le gabarit : paramètre direct de
// /auth/confirm (adresse insérée telle quelle), ou paramètre de l'adresse de
// retour contenue dans ?next= (adresse encodée).
export function claimFromLink(url: URL): string | null {
  const direct = url.searchParams.get(CLAIM_PARAM);
  if (direct) return direct;
  const next = url.searchParams.get("next");
  if (!next || next.startsWith("/")) return null;
  try {
    return new URL(next).searchParams.get(CLAIM_PARAM);
  } catch {
    return null;
  }
}

// Purge quotidienne : les réclamations expirées. Renvoie les identifiants supprimés.
export async function purgeLoginClaims(now: Date, restrict: string): Promise<string[]> {
  try {
    return await deleteRowsReturning("login_claims", `expires_at=lt.${encodeURIComponent(now.toISOString())}${restrict}`, "id");
  } catch (caught) {
    if (isMissingRelation(caught)) return [];
    throw caught;
  }
}
