import { createHash, randomBytes } from "node:crypto";
import { deleteRowsReturning, deleteRowsReturningAll, insertRow, isMissingColumn, isMissingRelation, selectRows } from "@/lib/supabase/server";
import type { Attribution } from "@/lib/analytics/first-party";

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

// Mission #162 — LES COLONNES D'ATTRIBUTION, et leur repli.
//
// La migration 20261007000039 est appliquée à la main : le code peut être
// déployé avant elle. Une insertion qui échoue sur une colonne absente est
// donc rejouée SANS l'attribution — on perd la mesure, jamais la réclamation,
// donc jamais le rattachement des analyses anonymes.
const COLONNES_ATTRIBUTION = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer_host"] as const;

function colonnesDe(attribution: Attribution | null): Record<string, string | null> {
  if (!attribution) return {};
  return {
    utm_source: attribution.utm_source ?? null,
    utm_medium: attribution.utm_medium ?? null,
    utm_campaign: attribution.utm_campaign ?? null,
    utm_content: attribution.utm_content ?? null,
    referrer_host: attribution.referrer_host ?? null,
  };
}

function attributionDe(row: Record<string, unknown>): Attribution | null {
  const lire = (cle: string) => (typeof row[cle] === "string" && row[cle] !== "" ? (row[cle] as string) : null);
  const attribution: Attribution = {
    utm_source: lire("utm_source"), utm_medium: lire("utm_medium"), utm_campaign: lire("utm_campaign"),
    utm_content: lire("utm_content"), referrer_host: lire("referrer_host"),
  };
  return Object.values(attribution).some((champ) => champ !== null) ? attribution : null;
}

// Enregistre la réclamation et renvoie le secret à glisser dans le lien. null :
// rien d'enregistré (table absente, base injoignable) — la connexion se fait
// quand même, avec l'ancien comportement (cookie présent au clic).
//
// Mission #162 — le jeton anonyme peut désormais être absent : une réclamation
// existe aussi pour porter SEULEMENT une attribution, quand quelqu'un arrive
// avec des UTM et crée son compte sans avoir rien analysé.
export async function createLoginClaim(
  email: string,
  anonToken: string | null,
  attribution: Attribution | null = null,
  now: Date = new Date(),
): Promise<string | null> {
  const nonce = randomBytes(24).toString("base64url");
  const base = {
    email: email.trim().toLowerCase(),
    anon_token: anonToken,
    nonce_hash: digest(nonce),
    expires_at: new Date(now.getTime() + LOGIN_CLAIM_TTL_MINUTES * 60_000).toISOString(),
  };
  try {
    try {
      await insertRow("login_claims", { ...base, ...colonnesDe(attribution) });
    } catch (caught) {
      if (!isMissingColumn(caught) || !attribution) throw caught;
      console.warn(JSON.stringify({ event: "login_claim_attribution_ignoree", reason: "colonne absente : appliquer la migration 20261007000039" }));
      await insertRow("login_claims", base);
    }
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
// Mission #162 — la réclamation rend maintenant DEUX choses : le jeton anonyme
// à rattacher, et l'attribution relevée quand le lien a été demandé. Les deux
// sortent du même DELETE, celui qui vérifie le secret, l'adresse et la date.
export type RedeemedClaim = { anonToken: string | null; attribution: Attribution | null };

export async function redeemLoginClaimFull(nonce: string | null, email: string | null, now: Date = new Date()): Promise<RedeemedClaim> {
  const vide: RedeemedClaim = { anonToken: null, attribution: null };
  if (!nonce || !NONCE.test(nonce) || !email) return vide;
  const filtre = `nonce_hash=eq.${digest(nonce)}&email=eq.${encodeURIComponent(email.trim().toLowerCase())}&expires_at=gt.${encodeURIComponent(now.toISOString())}`;
  try {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await deleteRowsReturningAll("login_claims", filtre, `anon_token,${COLONNES_ATTRIBUTION.join(",")}`);
    } catch (caught) {
      // Migration pas encore appliquée : la réclamation doit quand même être
      // consommée, sinon le rattachement des analyses anonymes s'arrête.
      if (!isMissingColumn(caught)) throw caught;
      console.warn(JSON.stringify({ event: "login_claim_attribution_ignoree", reason: "colonne absente à la lecture" }));
      rows = (await deleteRowsReturning("login_claims", filtre, "anon_token")).map((anon_token) => ({ anon_token }));
    }
    const row = rows[0];
    if (!row) return vide;
    return {
      anonToken: typeof row.anon_token === "string" && row.anon_token !== "" ? row.anon_token : null,
      attribution: attributionDe(row),
    };
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "login_claim_error",
        operation: "redeem",
        reason: isMissingRelation(caught) ? "table login_claims absente" : "lecture",
      }),
    );
    return vide;
  }
}

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

// Mission #162 — L'ATTRIBUTION DE LA VISITE QUI A SOUMIS UNE OFFRE AVEC CE
// JETON, relue au moment où le lien de connexion est demandé.
//
// Sur /connexion l'adresse ne porte plus rien : les UTM sont restés sur la
// page d'arrivée, et un lien interne n'a pas le droit de les recopier (#152).
// Le seul fil qui relie encore cette demande à l'arrivée est le cookie
// anonyme, httpOnly, que le serveur lit lui-même — et le deal qu'il a créé.
//
// La plus récente : quelqu'un qui revient par un autre canal et analyse à
// nouveau est attribué à sa dernière venue, pas à la première. Une erreur de
// lecture ou une colonne absente ne rend rien, et la connexion continue.
// Mission #163 — LE DRAPEAU DIT À QUEL MAILLON LA CHAÎNE A LÂCHÉ.
//
// Cette lecture peut ne rien rendre pour quatre raisons qui n'appellent pas la
// même action, et elles se ressemblaient toutes : un `null`. Une inscription
// non attribuée qui ne devrait pas l'être obligeait alors à deviner.
//
// Chaque étape a son étiquette, et elles ne se refusionnent pas : le test
// tests/attribution-inscription.test.ts échoue si deux situations distinctes
// se mettent à produire la même.
//
// L'étiquette dit OÙ, jamais QUOI : aucun jeton, aucun identifiant, aucune
// adresse, aucun contenu ne passe dans le journal.
export const PREMIER_CONTACT_ETAPES = {
  // Ce navigateur n'a jamais lancé d'analyse anonyme : il n'y a rien à relire.
  // Ce n'est pas une panne, c'est un parcours sans premier contact.
  sansJeton: "sans_jeton_anonyme",
  // Un jeton, mais aucun deal à son nom : analyse purgée, ou jeton d'un autre
  // environnement. Là, quelque chose s'est perdu.
  aucunDeal: "aucun_deal_pour_ce_jeton",
  // Un deal, mais il ne porte aucune attribution : arrivée directe, ou deal
  // créé avant la migration 20261007000039.
  dealSansAttribution: "deal_sans_attribution",
  // La migration n'est pas appliquée sur cet environnement.
  colonneAbsente: "colonne_absente",
  // Base injoignable ou requête refusée.
  lecture: "lecture",
} as const;

export type PremierContactEtape = (typeof PREMIER_CONTACT_ETAPES)[keyof typeof PREMIER_CONTACT_ETAPES];

function journalPremierContact(etape: PremierContactEtape): void {
  console.warn(JSON.stringify({ event: "attribution_premier_contact_indisponible", etape }));
}

export async function firstTouchForAnonToken(anonToken: string | null): Promise<Attribution | null> {
  if (!anonToken) {
    journalPremierContact(PREMIER_CONTACT_ETAPES.sansJeton);
    return null;
  }
  try {
    const rows = await selectRows<Record<string, unknown>>(
      "deals",
      `select=${COLONNES_ATTRIBUTION.join(",")}&anon_token=eq.${encodeURIComponent(anonToken)}&order=created_at.desc&limit=1`,
    );
    if (!rows[0]) {
      journalPremierContact(PREMIER_CONTACT_ETAPES.aucunDeal);
      return null;
    }
    const attribution = attributionDe(rows[0]);
    if (!attribution) journalPremierContact(PREMIER_CONTACT_ETAPES.dealSansAttribution);
    return attribution;
  } catch (caught) {
    journalPremierContact(isMissingColumn(caught) ? PREMIER_CONTACT_ETAPES.colonneAbsente : PREMIER_CONTACT_ETAPES.lecture);
    return null;
  }
}

// Suppression de compte (mission #068) : les réclamations en cours de cette
// adresse partent avec le compte, sans attendre leur expiration. Une erreur
// autre qu'une table absente est remontée : la suppression doit être complète.
export async function deleteLoginClaimsForEmail(email: string | null): Promise<number> {
  if (!email) return 0;
  try {
    const ids = await deleteRowsReturning("login_claims", `email=eq.${encodeURIComponent(email.trim().toLowerCase())}`, "id");
    return ids.length;
  } catch (caught) {
    if (isMissingRelation(caught)) return 0;
    throw caught;
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
