import { isRobot } from "@/lib/analytics/robots";
import { isMeasurementAgent } from "@/lib/telemetry/internal";
import { agentFamily } from "@/lib/telemetry/visiteur";

// Mission #213 — LE COMPTEUR COMPTAIT DES ROBOTS QUI NE DISENT PAS LEUR NOM.
//
// CONSTAT (11→14/11, relevé dans /admin/evenements) : 5 à 8 landing_view par
// jour sur l'accueil, toutes en « direct », sans référent, empreinte
// différente à chaque fois, User-Agent Chrome. Sur 26 pages vues : 0
// défilement, 0 geste, 0 contact avec le champ de collage, et un
// page_engagement 2 à 4 secondes après le landing_view. Le trafic humain réel
// de la période se comptait sur trois doigts.
//
// Ce que ça coûtait : le compteur de l'admin est la source autoritaire du
// projet, trois canaux ont été fermés sur la foi de ses dénominateurs, et il
// surestimait d'un ordre de grandeur.
//
// ─── POURQUOI LE FILTRE EXISTANT NE POUVAIT PAS LES VOIR ───────────────────
//
// lib/analytics/robots.ts le dit depuis la #120, en toutes lettres : il ne
// filtre pas « les robots » mais « les robots qui DISENT qui ils sont ». Ces
// visites-là annoncent Chrome. Le filtre n'était pas cassé, il était hors
// sujet — et rien à l'écran ne permettait de s'en apercevoir, puisqu'un robot
// nommé était JETÉ sans laisser de ligne.
//
// ─── CE QUI A ÉTÉ COMPARÉ, ET CE QUI EST RETENU ────────────────────────────
//
// 1. LISTES D'AGENTS MAINTENUES PUBLIQUEMENT (matomo/device-detector,
//    monperrus/crawler-user-agents, la liste COUNTER-Robots des éditeurs,
//    la liste IAB/ABC des araignées, payante). C'est l'état de l'art pour
//    les robots déclarés, et c'est déjà ce que fait l'expression de la #120
//    à la main. RETENU, inchangé : ajouter une dépendance de plusieurs
//    milliers d'entrées pour un site qui vient d'ouvrir coûterait plus que
//    la ligne qu'il ferait gagner — mais ces listes ne répondent PAS au
//    constat, qui porte sur un agent qui ment.
//
// 2. ROBOTS QUI SE DÉCLARENT PAR SIGNATURE. C'est le standard en cours :
//    `Signature-Agent`, `Signature` et `Signature-Input`, signatures de
//    messages HTTP (brouillon IETF draft-ietf-webbotauth-httpsig-protocol,
//    adopté en groupe de travail en septembre 2026, révision -01 d'octobre
//    2026 ; Cloudflare le valide dans son programme de robots vérifiés
//    depuis juillet 2025). RETENU : un agent qui signe est un agent qui se
//    déclare, et le reconnaître coûte la lecture d'un en-tête. On ne VÉRIFIE
//    pas la signature — la vérifier demanderait d'aller chercher un
//    annuaire de clés à chaque page, et une signature contrefaite ne
//    servirait qu'à se faire écarter des compteurs.
//
// 3. HEURISTIQUES COMPORTEMENTALES. Les signaux de la #209 existent déjà et
//    décrivent exactement le constat : `scroll: "0"`, `scrolled: false`,
//    `first_action: "aucun"`, `input: "aucun"`, `dwell: "0-1s"`.
//    PAS RETENU COMME CLASSIFICATEUR AUTOMATIQUE, et c'est un choix :
//    un vrai visiteur qui ouvre la page et repart immédiatement produit la
//    MÊME ligne. Classer là-dessus effacerait du cockpit des gens réels, ce
//    que ce dépôt tient pour la pire des deux erreurs
//    (lib/telemetry/tagged.ts : « marquer à tort effacerait du cockpit un
//    vrai visiteur »). Ces signaux restent lisibles à l'écran comme
//    CORROBORATION, pas comme verdict.
//
// 4. INDICES CLIENT MANQUANTS (`Sec-CH-UA`). RETENU, et c'est la règle qui
//    attrape le constat. Voir plus bas : elle a été MESURÉE avant d'être
//    écrite, parce que la version naïve était fausse.
//
// Aucun filtrage par adresse IP, aucune résolution inverse, rien de nouveau
// dans l'URL : la décision tient dans les en-têtes déjà reçus.

export const ROBOT_REASONS = ["declare", "signature", "prefetch", "sans_agent", "sans_indices"] as const;
export type RobotReason = (typeof ROBOT_REASONS)[number];

export const ROBOT_LABEL: Readonly<Record<RobotReason, string>> = {
  declare: "Robot qui se nomme",
  signature: "Agent signé",
  prefetch: "Préchargement",
  sans_agent: "Sans User-Agent",
  sans_indices: "Chrome sans indices client",
};

export type VerdictVisite = {
  robot: boolean;
  reason: RobotReason | null;
  /** Forme grossière de l'agent. JAMAIS le User-Agent brut. */
  agent_signature: string | null;
};

const HUMAIN: VerdictVisite = { robot: false, reason: null, agent_signature: null };

// ─── LA RÈGLE DES INDICES CLIENT, ET LA MESURE QUI L'A CORRIGÉE ────────────
//
// Un navigateur Chromium envoie par défaut les indices client de faible
// entropie — `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` — et ils
// sont produits INDÉPENDAMMENT de la chaîne User-Agent. Un client qui recopie
// une chaîne Chrome sans reproduire les en-têtes qui vont avec se trahit donc.
//
// LA VERSION NAÏVE DE CETTE RÈGLE EST FAUSSE, et c'est mesuré, pas supposé.
// Relevé le 14/11/2026 sur un vrai Chromium 156 (route jetable `/dev/entetes`,
// supprimée depuis), quatre types de requêtes vers le même point :
//
//   navigation (sec-fetch-dest: document)   sec-ch-ua ABSENT
//   fetch      (dest: empty)                sec-ch-ua présent
//   sendBeacon (dest: empty)                sec-ch-ua présent
//   image      (dest: image)                sec-ch-ua présent
//
// « Chrome sans Sec-CH-UA donc robot » aurait donc classé robot CHAQUE
// chargement de page de ce navigateur. La règle est par conséquent limitée
// aux SOUS-REQUÊTES — et ça tombe bien : les deux seuls chemins qui écrivent
// une visite en sont (app/api/events, appelé par sendBeacon ou fetch, et
// app/api/vue, qui est une image).
//
// CE QU'ELLE NE PROUVE PAS. Un robot qui envoie un `Sec-CH-UA` cohérent passe
// — c'est écrit dans les discussions publiques sur le sujet, et c'est vrai.
// Cette règle attrape la contrefaçon négligente, qui est celle du constat ;
// elle ne prétend pas attraper la contrefaçon soignée. D'où le point 5 de la
// mission : le classement est AFFICHÉ et RÉVISABLE, pas définitif.
const CHROMIUM = /\bChrome\/|\bChromium\/|\bCriOS\/|\bEdg(iOS|A|)\//i;

// LES NAVIGATEURS INTÉGRÉS SONT HORS DE CETTE RÈGLE, et c'est le garde-fou le
// plus important du fichier.
//
// Le navigateur intégré d'Instagram sur Android annonce « Chrome/139 » dans sa
// chaîne : la règle le prenait donc pour une contrefaçon négligente. S'il
// n'envoie pas les indices client — et je n'ai PAS pu le mesurer depuis ici,
// faute d'un téléphone dans la boucle — la règle effacerait du cockpit
// exactement le trafic dont ce produit vit : les créatrices qui ouvrent un
// lien depuis un message privé (missions #124, #159, #212).
//
// On n'écarte donc pas ce qu'on n'a pas mesuré. Un robot qui se ferait passer
// pour le navigateur d'Instagram passerait : c'est le prix, il est assumé, et
// il est du bon côté — ce dépôt tient pour la pire des deux erreurs d'effacer
// un visiteur réel (lib/telemetry/tagged.ts).
const INTEGRES: ReadonlySet<string> = new Set(["instagram", "tiktok"]);

function sansIndicesClient(headers: Headers, userAgent: string): boolean {
  const dest = headers.get("sec-fetch-dest");
  // Pas de sec-fetch-dest : navigateur ancien, ou navigation. On ne punit pas.
  if (!dest || dest === "document") return false;
  if (!CHROMIUM.test(userAgent)) return false;
  if (INTEGRES.has(agentFamily(userAgent))) return false;
  return headers.get("sec-ch-ua") === null;
}

export function classerVisite(headers: Headers): VerdictVisite {
  const userAgent = headers.get("user-agent");
  const agent_signature = signatureAgent(headers, userAgent);

  // Le navigateur de mesure (#135) n'est pas un robot : il est INTERNE, et
  // compté à part. Le classer robot le ferait disparaître deux fois.
  if (isMeasurementAgent(userAgent)) return { ...HUMAIN, agent_signature };

  // Aucun navigateur n'omet son User-Agent (lib/analytics/robots.ts, #120).
  if (!userAgent) return { robot: true, reason: "sans_agent", agent_signature };
  if (isRobot(userAgent)) return { robot: true, reason: "declare", agent_signature };
  // Un agent qui signe ses requêtes se déclare : brouillon IETF web bot auth.
  if (headers.get("signature-agent") || headers.get("signature-input")) {
    return { robot: true, reason: "signature", agent_signature };
  }
  // Un préchargement n'est personne qui regarde.
  const but = headers.get("sec-purpose") ?? headers.get("purpose") ?? "";
  if (/prefetch|prerender/i.test(but)) return { robot: true, reason: "prefetch", agent_signature };
  if (sansIndicesClient(headers, userAgent)) return { robot: true, reason: "sans_indices", agent_signature };
  return { ...HUMAIN, agent_signature };
}

// ─── L'EMPREINTE DE L'AGENT ────────────────────────────────────────────────
//
// Ce que la mission demande d'enregistrer « au minimum », et ce qui permet de
// TRANCHER là où `visitor` ne peut pas : `visitor` est un hachage de
// sel+IP+agent, donc il CHANGE dès que l'adresse change — c'est précisément
// ce que le constat décrit (« empreinte différente à chaque fois »). Une
// forme d'agent, elle, ne bouge pas. Vingt-six pages vues portant vingt-six
// `visitor` distincts et UNE SEULE forme d'agent, c'est un client qui tourne
// ses adresses ; cinq à huit personnes réelles, non.
//
// CE N'EST PAS UN HACHAGE, et c'est volontaire. Un sha256 de User-Agent sans
// secret se casse par énumération — l'espace des chaînes est petit — donc il
// ne protégerait rien tout en empêchant de LIRE la valeur à l'écran. Et le
// User-Agent brut n'est jamais écrit : la décision est dans
// lib/telemetry/visiteur.ts depuis la #131, avec sa raison (« il
// identifierait un appareil bien mieux que l'empreinte, et pour toujours »).
//
// La forme est donc GROSSIÈRE PAR CONSTRUCTION : famille, version majeure,
// plateforme, et mobile ou non. Quelques centaines de valeurs possibles,
// partagées par des millions d'appareils. Aucune version mineure, aucun
// modèle d'appareil, aucune langue, aucune résolution.
const PLATEFORMES: ReadonlyArray<{ motif: RegExp; nom: string }> = [
  { motif: /\bAndroid\b/i, nom: "android" },
  { motif: /\biPhone\b|\biPad\b|\biPod\b|\biOS\b/i, nom: "ios" },
  { motif: /\bWindows\b/i, nom: "windows" },
  { motif: /\bMac OS X\b|\bMacintosh\b/i, nom: "macos" },
  { motif: /\bCrOS\b/i, nom: "chromeos" },
  { motif: /\bLinux\b|\bX11\b/i, nom: "linux" },
];

const VERSIONS: ReadonlyArray<RegExp> = [
  /\bEdg(?:iOS|A)?\/(\d+)/i,
  /\bCriOS\/(\d+)/i,
  /\bFxiOS\/(\d+)/i,
  /\bFirefox\/(\d+)/i,
  /\bChrome\/(\d+)/i,
  /\bChromium\/(\d+)/i,
  /\bVersion\/(\d+)/i,
];

export function signatureAgent(headers: Headers, userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const famille = agentFamily(userAgent);
  const version = VERSIONS.reduce<string | null>((trouve, motif) => trouve ?? userAgent.match(motif)?.[1] ?? null, null);
  const plateforme = PLATEFORMES.find(({ motif }) => motif.test(userAgent))?.nom ?? "autre";
  // L'indice client est plus fiable que la chaîne pour le format : il est
  // produit à part. À défaut, on lit la chaîne.
  const indice = headers.get("sec-ch-ua-mobile");
  const mobile = indice ? indice.includes("?1") : /\bMobi|\bAndroid\b|\biPhone\b/i.test(userAgent);
  return `${famille}-${version ?? "x"}|${plateforme}|${mobile ? "mobile" : "bureau"}`;
}
