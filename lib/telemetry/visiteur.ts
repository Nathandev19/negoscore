import { createHash, randomBytes } from "node:crypto";
import { insertIfAbsent, selectRows } from "@/lib/supabase/server";
import { isRobot } from "@/lib/analytics/robots";
import { isMeasurementAgent } from "@/lib/telemetry/internal";

// Mission #131 — SAVOIR SI DEUX ÉVÉNEMENTS VIENNENT DU MÊME APPAREIL, SANS
// JAMAIS CONSERVER D'ADRESSE IP.
//
// Le 01/10, trois questions ont coûté une heure chacune : « ces 17 vues de
// guide, robot ou gens ? », « cette visite, Franceska ou pas ? », « ce +1 sur
// dm_exemple, moi ou une créatrice ? ». Les trois se répondent en dix secondes
// avec une empreinte par appareil et par jour.
//
// LE MÉCANISME, celui de Plausible et de Fathom :
//
//   empreinte = sha256( sel_du_jour + adresse IP + user-agent )
//
// Le sel est tiré au hasard par le serveur, CHANGE CHAQUE JOUR, et l'ancien est
// détruit par la purge. Deux jours ne peuvent donc pas être reliés : même
// appareil, même IP, même navigateur, et pourtant deux empreintes sans rapport.
// L'adresse IP n'est jamais écrite — ni en base, ni dans un journal, ni à
// l'écran. Elle n'existe que le temps d'un calcul, en mémoire.
//
// C'est ce qui garde le site dans l'exemption de consentement de la CNIL, donc
// sans bandeau cookies.
//
// ON NE GARDE QUE SIX CARACTÈRES. Le hash complet n'est pas tronqué à
// l'affichage : il n'est jamais écrit. Six caractères hexadécimaux font
// 16,7 millions de valeurs ; à cent événements par jour, la probabilité que
// deux appareils différents tombent sur la même empreinte dans la même journée
// est de l'ordre de 0,03 %. On accepte ce risque-là pour qu'il n'existe nulle
// part de hash complet à recouper.

export const VISITOR_LENGTH = 6;

// ─── Le sel du jour ────────────────────────────────────────────────────────
//
// Il doit être le MÊME pour toutes les instances serverless d'une journée :
// il vit donc dans une table, pas dans la mémoire d'un processus. Il est créé
// à la première requête du jour, et la purge quotidienne efface ceux de plus
// de deux jours (lib/privacy/purge.ts).
//
// Pourquoi pas un sel dérivé d'un secret permanent : il serait recalculable
// pour n'importe quel jour passé. Quelqu'un qui aurait le secret et une IP à
// tester pourrait vérifier si cette personne est passée. Un sel tiré au hasard
// puis détruit rend la question sans réponse, y compris pour nous.

type SaltRow = { day: string; salt: string };

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { day: string; salt: string; at: number } | null = null;

export function saltDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function dailySalt(now: Date = new Date()): Promise<string | null> {
  const day = saltDay(now);
  if (cache && cache.day === day && Date.now() - cache.at < CACHE_TTL_MS) return cache.salt;
  try {
    const existantes = await selectRows<SaltRow>("telemetry_salts", `day=eq.${day}&select=day,salt&limit=1`);
    let salt = existantes[0]?.salt ?? null;
    if (!salt) {
      // Deux instances peuvent créer le sel du jour en même temps : l'insertion
      // ignore le conflit, et on relit pour prendre celui qui a gagné. Sans
      // cette relecture, deux moitiés de la journée porteraient deux sels.
      const propose = randomBytes(32).toString("hex");
      await insertIfAbsent("telemetry_salts", { day, salt: propose });
      const relues = await selectRows<SaltRow>("telemetry_salts", `day=eq.${day}&select=day,salt&limit=1`);
      salt = relues[0]?.salt ?? null;
    }
    if (!salt) return null;
    cache = { day, salt, at: Date.now() };
    return salt;
  } catch {
    // Table absente (migration pas encore appliquée) ou base injoignable :
    // aucune empreinte. L'événement s'écrit sans, plutôt que de ne pas
    // s'écrire. Un trou dans le diagnostic est moins grave qu'une mesure
    // perdue.
    return null;
  }
}

export function forgetDailySalt(): void {
  cache = null;
}

// ─── L'empreinte ───────────────────────────────────────────────────────────

export function visitorFingerprint(salt: string | null, ip: string | null, userAgent: string | null): string | null {
  // Sans sel, pas d'empreinte : on ne hache jamais une IP avec une valeur
  // devinable. Sans IP ni user-agent non plus, il n'y a rien à distinguer.
  if (!salt || (!ip && !userAgent)) return null;
  return createHash("sha256")
    .update(`${salt}|${ip ?? ""}|${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, VISITOR_LENGTH);
}

// L'adresse du client, telle que Vercel la transmet. Elle ne sort pas de cette
// fonction : seul le hash en ressort.
export function clientIp(headers: Headers): string | null {
  const transmise = headers.get("x-forwarded-for");
  if (transmise) {
    const premiere = transmise.split(",")[0]?.trim();
    if (premiere) return premiere;
  }
  return headers.get("x-real-ip")?.trim() || null;
}

// ─── La famille de navigateur ──────────────────────────────────────────────
//
// Pas le user-agent : sa FAMILLE. C'est ce qu'on veut lire — « navigateur
// intégré Instagram » répond à la question « cette visite vient-elle d'un DM ».
// Le user-agent brut, lui, n'est jamais écrit : il identifierait un appareil
// bien mieux que l'empreinte, et pour toujours.
//
// L'ordre compte. Les navigateurs intégrés annoncent Safari ou Chrome en plus
// de leur propre nom, et le navigateur de mesure annonce Chrome : on cherche
// donc du plus spécifique au plus général.
export const AGENT_FAMILIES = ["mesure", "robot", "instagram", "tiktok", "edge", "chrome", "firefox", "safari", "inconnu"] as const;
export type AgentFamily = (typeof AGENT_FAMILIES)[number];

export const AGENT_LABEL: Readonly<Record<AgentFamily, string>> = {
  mesure: "Mesure",
  robot: "Robot nommé",
  instagram: "Navigateur intégré Instagram",
  tiktok: "Navigateur intégré TikTok",
  edge: "Edge",
  chrome: "Chrome",
  firefox: "Firefox",
  safari: "Safari",
  inconnu: "Inconnu",
};

export function agentFamily(userAgent: string | null | undefined): AgentFamily {
  if (!userAgent) return "inconnu";
  if (isMeasurementAgent(userAgent)) return "mesure";
  if (isRobot(userAgent)) return "robot";
  // Instagram : « Instagram 302.0.0.23.109 Android » ou « ... Instagram ... »
  // sur iOS. TikTok : « musical_ly » sur Android, « BytedanceWebview » sur iOS,
  // les deux ensemble le plus souvent.
  if (/\bInstagram\b/i.test(userAgent)) return "instagram";
  if (/musical_ly|BytedanceWebview|\bTikTok\b/i.test(userAgent)) return "tiktok";
  if (/\bEdg(iOS|A|)\//i.test(userAgent)) return "edge";
  if (/\bCriOS\/|\bChrome\/|\bChromium\//i.test(userAgent)) return "chrome";
  if (/\bFxiOS\/|\bFirefox\//i.test(userAgent)) return "firefox";
  if (/\bSafari\//i.test(userAgent)) return "safari";
  return "inconnu";
}
