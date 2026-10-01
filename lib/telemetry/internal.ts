import { createHmac, timingSafeEqual } from "node:crypto";
import { serverSalt } from "@/lib/security/request";

// Mission #118 — le cockpit ne compte aucun de mes comptes, ni aucun de mes
// appareils.
//
// La télémétrie de #103 sépare production / preview / development / test. Elle
// ne sépare PAS le trafic du propriétaire de celui des visiteurs : au 25/09 le
// cockpit affichait 10 visites et 1 analyse terminée, toutes produites par
// Nathan en production. Le seul chiffre qui compte pendant le lancement — un
// inconnu a-t-il utilisé le produit — était illisible.
//
// DEUX NOTIONS DISTINCTES, DEUX CHAMPS. `environment` répond à « quel
// déploiement a écrit cette ligne » ; `internal` répond à « qui l'a produite ».
// Elles sont orthogonales : on peut être interne sur la production comme sur
// une prévisualisation. Les fondre dans une seule colonne obligerait à choisir
// laquelle des deux on perd. Et `resolveEnvironment` reste ce qu'elle est :
// pure, décidée par le processus, testée sans muter process.env — alors que
// l'appartenance interne se décide par REQUÊTE. Ce module ne la touche pas.
//
// TROIS CAS À COUVRIR, ET LE TROISIÈME EST LE PLUS IMPORTANT :
//   1. connecté avec OWNER_EMAIL ;
//   2. connecté avec un autre compte de test (liste INTERNAL_EMAILS) ;
//   3. DÉCONNECTÉ, sur le téléphone ou le PC — le cas courant, celui qui
//      produit le plus de visites parasites.
//
// Le cas 3 se règle par un cookie qui marque CE NAVIGATEUR comme interne et
// survit à la déconnexion. Il est posé automatiquement dès qu'une session
// interne est vérifiée (connexion, ou passage du proxy sur une page de
// compte), et à la demande par /api/interne.

// Mission #135 — LE NAVIGATEUR DE MESURE S'ANNONCE.
//
// Les vérifications de #134 et #137 sont passées par un Chrome sans tête
// piloté contre la production. Il remplaçait son User-Agent par celui d'un
// téléphone Android pour mesurer les bonnes conditions — et il a donc été
// compté comme un vrai visiteur. Au moins une visite `dm_exemple` du
// cockpit vient de là.
//
// Le cookie de marquage ne peut pas servir : son secret vit dans Vercel et
// n'en sort pas. Le jeton ci-dessous, lui, n'ouvre RIEN. Il ne donne aucun
// droit, ne masque aucune donnée, et n'a donc pas à être secret : il dit
// seulement « cette requête vient d'une mesure ». Quelqu'un qui le
// copierait s'effacerait lui-même d'un tableau qu'il ne voit pas — la même
// propriété que le cookie de #118.
//
// La ligne est ÉCRITE, marquée interne, jamais supprimée : on veut pouvoir
// compter combien de requêtes de mesure ont eu lieu.
//
// Un seul endroit : scripts/mesure-pages.cjs le lit ici, et
// tests/mesure-interne.test.ts refuse qu'ils divergent.
export const MEASURE_AGENT_TOKEN = "NegoscoreMesure/1";

// Le jeton est cherché tel quel, sans sensibilité à la casse : un
// User-Agent est une chaîne libre, et on ne veut pas qu'une majuscule
// décide si une mesure pollue le cockpit.
export function isMeasurementAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.toLowerCase().includes(MEASURE_AGENT_TOKEN.toLowerCase());
}

export const INTERNAL_COOKIE = "ns_interne";
export const INTERNAL_EMAILS_ENV = "INTERNAL_EMAILS";
export const INTERNAL_MARK_SECRET_ENV = "INTERNAL_MARK_SECRET";

// Deux ans : on ne veut pas remarquer ses appareils tous les mois. Le cookie
// ne porte aucune autorisation, sa durée n'est pas un risque.
const INTERNAL_MAX_AGE = 60 * 60 * 24 * 730;

// ─── La liste des adresses internes ────────────────────────────────────────
//
// Une variable d'environnement, pas une table : elle est lue par le proxy, qui
// passe avant chaque page. Une requête en base à cet endroit coûterait un
// aller-retour Supabase sur chaque navigation. Ajouter une adresse ne demande
// donc AUCUN changement de code — la variable se modifie dans Vercel — mais un
// redéploiement du même code pour qu'elle soit relue (même contrainte que
// OWNER_EMAIL, voir lib/admin/owner.ts).
//
// Séparateurs tolérés : virgule, point-virgule, espace, retour à la ligne.
// Variable absente ou vide : personne n'est interne, à part le propriétaire.
export function parseInternalEmails(configured: string | undefined): string[] {
  if (!configured) return [];
  return configured
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

// Le propriétaire est interne d'office : il n'a pas à s'inscrire dans une
// seconde liste pour ne pas se compter lui-même.
export function isInternalEmail(
  email: string | null | undefined,
  configured: string | undefined = process.env.INTERNAL_EMAILS,
  owner: string | undefined = process.env.OWNER_EMAIL,
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized === "") return false;
  return internalList(configured, owner).includes(normalized);
}

export function internalList(
  configured: string | undefined = process.env.INTERNAL_EMAILS,
  owner: string | undefined = process.env.OWNER_EMAIL,
): string[] {
  const ownerEmail = (owner ?? "").trim().toLowerCase();
  const list = parseInternalEmails(configured);
  return ownerEmail === "" ? list : [...new Set([ownerEmail, ...list])];
}

// ─── Le cookie, et pourquoi il n'est pas falsifiable ───────────────────────
//
// Sa valeur est un HMAC-SHA256 d'une constante avec un secret SERVEUR : le
// même sel que celui du hachage d'IP (lib/security/request.ts). Personne ne
// peut la fabriquer sans ce secret, et la comparaison est à temps constant.
//
// La règle de #103 tient donc toujours : LE CLIENT N'A AUCUNE AUTORITÉ. Il ne
// peut pas se déclarer interne, et il ne pourrait de toute façon rien en
// tirer — la seule conséquence du marquage est de retirer ses propres lignes
// des chiffres du cockpit. Un visiteur qui y parviendrait s'effacerait
// lui-même d'un tableau qu'il ne voit pas.
//
// Secret absent : aucun cookie ne peut être émis NI validé. Personne n'est
// interne, et rien ne casse.
const INTERNAL_MESSAGE = "negoscore:interne:v1";

export function internalSecret(): string | null {
  return serverSalt();
}

export function internalToken(secret: string): string {
  return `v1.${createHmac("sha256", secret).update(INTERNAL_MESSAGE).digest("hex")}`;
}

export function internalTokenValid(value: string | null | undefined, secret: string | null): boolean {
  if (!value || !secret) return false;
  const expected = Buffer.from(internalToken(secret));
  const given = Buffer.from(value);
  // timingSafeEqual exige deux tampons de même longueur : la différence de
  // taille est donc décidée avant, et elle ne révèle rien qu'on ne sache déjà.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

// ─── Marquer un navigateur qui ne peut pas se connecter ────────────────────
//
// Mission #127 — les navigateurs intégrés d'Instagram et de TikTok n'ont pas de
// barre d'adresse modifiable : on n'y atteint une page qu'en cliquant un lien,
// et s'y connecter demande de recevoir un email, de l'ouvrir ailleurs, et de
// perdre la session. Vérifier un lien depuis ces applications comptait donc
// comme une vraie visite de créatrice.
//
// Le marquage par compte interne de la mission #118 reste la voie normale.
// Celle-ci est la même marque — le même cookie, lu par le même chemin — ouverte
// par un SECRET dans l'adresse, puisque c'est tout ce qu'on peut transmettre à
// ces navigateurs-là.
//
// Le secret vit dans INTERNAL_MARK_SECRET, jamais dans le dépôt et jamais dans
// le code envoyé au navigateur. Variable absente ou vide : personne ne peut
// marquer, et la page répond comme une adresse inexistante. On ne se replie sur
// AUCUNE valeur par défaut — un secret par défaut serait un secret public.
export function markSecret(configured: string | undefined = process.env.INTERNAL_MARK_SECRET): string | null {
  const value = (configured ?? "").trim();
  return value === "" ? null : value;
}

// Comparaison à temps constant, et la longueur est traitée avant : une
// différence de taille ne dit rien qu'un essai ne dirait déjà.
export function markSecretValid(given: string | null | undefined, expected: string | null = markSecret()): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

// httpOnly, contrairement aux indicateurs d'affichage (ns_session, ns_proprio) :
// celui-ci n'a rien à dire au navigateur, et sa valeur n'a pas à être lisible
// par un script.
export function internalCookieHeader(secret: string | null = internalSecret()): string | null {
  if (!secret) return null;
  return `${INTERNAL_COOKIE}=${internalToken(secret)}; Path=/; Max-Age=${INTERNAL_MAX_AGE}; HttpOnly; SameSite=Lax${secureFlag()}`;
}

export function expiredInternalCookieHeader(): string {
  return `${INTERNAL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag()}`;
}
