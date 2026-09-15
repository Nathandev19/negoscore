import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderHtml } from "./templates.ts";
import type { ScreenSpec } from "./templates.ts";

// Génère les 8 captures de evals/fixtures-vision/ avec le Chromium headless
// déjà présent sur la machine (installé avec les navigateurs Playwright).
// Aucune dépendance : Chromium est appelé en ligne de commande, avec son
// profil et ses fichiers temporaires dans .cache/ du projet.
//
// pnpm eval:vision:fixtures

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "evals", "fixtures-vision");
const CACHE_DIR = path.join(ROOT, ".cache");
const SCALE = 2;

type VisionFixture = { name: string; source: string; spec: ScreenSpec };

// Le texte de chaque capture reprend mot pour mot la fixture texte source,
// découpé en bulles ou en paragraphes.
const FIXTURES: VisionFixture[] = [
  {
    name: "v01-dm-cosmetique",
    source: "01-dm-cosmetique",
    spec: {
      kind: "dm",
      degradation: "none",
      height: 844,
      handle: "aubepine.cosmetiques",
      displayName: "Aubépine Cosmétiques",
      initials: "AC",
      avatarColors: ["#e7a3b8", "#b06c8a"],
      timestamp: "Aujourd'hui 14:05",
      bubbles: [
        "Bonjour ! On adore ton contenu 🌸",
        "On te propose 300€ pour 2 vidéos TikTok, avec droits pub 6 mois, 3 mois d'exclusivité sur la catégorie cosmétique, raw footage inclus, révisions illimitées, paiement à 60 jours.",
        "Dis-nous si ça te va !",
        "L'équipe Aubépine Cosmétiques",
      ],
    },
  },
  {
    name: "v02-dm-spark-ads",
    source: "05-dm-spark-ads",
    spec: {
      kind: "dm",
      degradation: "none",
      height: 844,
      handle: "nomadelle.voyage",
      displayName: "Nomadelle",
      initials: "N",
      avatarColors: ["#8fb9a8", "#3e6d5c"],
      timestamp: "Hier 18:47",
      bubbles: [
        "Salut Jade ! C'est Hugo de Nomadelle (sacs de voyage).",
        "On te propose 2 TikToks publiés sur ton compte, 400 € pour les deux.",
        "On te demandera un code Spark Ads valable 30 jours pour booster les vidéos.",
        "Paiement à 30 jours à réception de ta facture. Pas d'exclusivité. Tu nous dis ?",
      ],
    },
  },
  {
    name: "v03-dm-vague-droits",
    source: "04-dm-vague-droits",
    spec: {
      kind: "dm",
      degradation: "none",
      height: 844,
      handle: "ondulia.officiel",
      displayName: "Ondulia",
      initials: "O",
      avatarColors: ["#9ab4e8", "#4a5fa8"],
      timestamp: "lun. 09:12",
      bubbles: ["hello, t dispo pour un ugc tiktok ce mois ci ?", "payé 150€, on aura besoin des droits pub. on en parle ?", "Maxence – Ondulia"],
    },
  },
  {
    name: "v04-mail-biscuits",
    source: "07-email-biscuits",
    spec: {
      kind: "mail",
      degradation: "none",
      height: 1000,
      subject: "Collaboration UGC – Les Délices de Marthe",
      senderName: "Paul Garrigue",
      senderEmail: "paul@delicesdemarthe.example",
      initial: "P",
      avatarColor: "#b0702c",
      time: "09:58",
      body: `Bonjour Nora,

Je suis Paul, responsable marketing chez Les Délices de Marthe, une marque de biscuits bio. Nous avons découvert ton compte et nous aimons beaucoup ton univers.

Nous cherchons une créatrice pour réaliser 2 vidéos UGC de 30 secondes, qui ne seront pas publiées sur ton compte : nous les utiliserons sur nos propres réseaux et en publicité payante pendant 3 mois, en France uniquement.

Nous te proposons 500 € HT pour les deux vidéos. Nous aurons également besoin des rushs bruts. Deux séries de retours sont prévues. Le paiement se fait à 30 jours après la livraison, et nous aimerions recevoir les vidéos sous 3 semaines après validation du brief.

Est-ce que cela te conviendrait ?

Bien à toi,
Paul Garrigue
Les Délices de Marthe`,
    },
  },
  {
    name: "v05-mail-anglais",
    source: "20-email-anglais",
    spec: {
      kind: "mail",
      degradation: "none",
      height: 840,
      subject: "UGC collab with Luminelle Labs",
      senderName: "Daniel Oakes",
      senderEmail: "daniel@luminellelabs.example",
      initial: "D",
      avatarColor: "#6a4fb3",
      time: "11:20",
      body: `Hi Chloé,

We're Luminelle Labs, a clean skincare brand launching in France. We'd love to work with you on 3 TikTok videos (20–40 seconds each), delivered to us — no posting on your account needed.

We can offer €500 for the three videos. We'd like paid usage rights for 3 months in France and Belgium, plus the raw footage. Payment is net 30. We include one round of revisions.

Looking forward to hearing from you!
Best,
Daniel Oakes
Partnerships, Luminelle Labs`,
    },
  },
  {
    name: "v06-dm-coupe-whitelisting",
    source: "06-dm-whitelisting",
    spec: {
      kind: "dm",
      degradation: "cut-bottom",
      height: 700,
      handle: "lunabrosse",
      displayName: "Lunabrosse",
      initials: "L",
      avatarColors: ["#d9b38c", "#8a5a3c"],
      timestamp: "Aujourd'hui 11:03",
      bubbles: [
        "Bonjour Sarah, nous sommes Lunabrosse, marque de mode éthique.",
        "Nous aimerions 3 Reels Instagram à 250 € le Reel.",
        "Nous souhaitons un accès whitelisting de 2 mois pour diffuser des publicités depuis ton compte, et une exclusivité d'1 mois sur la catégorie mode.",
        "Règlement à 45 jours.",
        "Belle journée, Clémence",
      ],
    },
  },
  {
    name: "v07-dm-flou-produit-offert",
    source: "02-dm-produit-offert",
    spec: {
      kind: "dm",
      degradation: "low-quality",
      height: 844,
      handle: "quietile.bougies",
      displayName: "Quiétile",
      initials: "Q",
      avatarColors: ["#e3c77a", "#a07a2a"],
      timestamp: "ven. 16:21",
      bubbles: [
        "Hello Léa ! Ici Lucie de Quiétile, on fait des bougies artisanales.",
        "On aimerait t'envoyer notre coffret Automne (valeur 89 €) en échange d'un Reel Instagram publié sur ton compte + 3 stories.",
        "Pas de rémunération financière pour cette collab, mais tu gardes le coffret !",
        "On pourrait aussi repartager le Reel sur notre page. Ça te tente ?",
      ],
    },
  },
  {
    name: "v08-photo-ecran-perpetuite",
    source: "18-piege-perpetuite",
    spec: {
      kind: "mail",
      degradation: "photo-of-screen",
      height: 1060,
      subject: "Conditions de notre collaboration — Maison Orvelle",
      senderName: "Victoire Anselme",
      senderEmail: "victoire@maisonorvelle.example",
      initial: "V",
      avatarColor: "#2f6f73",
      time: "19:04",
      body: `Bonjour Lina,

Suite à notre échange, voici le récapitulatif de notre proposition pour la campagne « Rituel du soir ».

Contenus : 2 vidéos verticales pour TikTok, de 30 secondes environ, livrées à notre équipe (sans publication de ta part).
Rémunération : 450 € HT pour les deux vidéos, payés à 30 jours.
Modifications : deux séries de retours incluses.
Exclusivité : aucune.

Conditions d'utilisation : afin de simplifier la gestion de nos campagnes, les droits d'exploitation des vidéos (diffusion sur nos réseaux sociaux, notre site et en publicité payante) nous sont consentis pour toute la durée de protection des droits d'auteur, sur tous les territoires. Tu restes bien sûr créditée lorsque cela est possible.

Nous restons disponibles pour toute question et avons hâte de travailler ensemble !

Belle soirée,
Victoire Anselme
Chargée de partenariats — Maison Orvelle`,
    },
  },
];

function chromiumPath(): string {
  const base = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : "";
  const candidates = [
    path.join(base, "chromium_headless_shell-1228", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
    path.join(base, "chromium-1228", "chrome-win64", "chrome.exe"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chromium introuvable : aucun navigateur Playwright déjà présent sur la machine.");
  return found;
}

function main() {
  const exe = chromiumPath();
  const tmp = path.join(CACHE_DIR, "tmp");
  mkdirSync(tmp, { recursive: true });

  for (const fixture of FIXTURES) {
    const dir = path.join(OUT_DIR, fixture.name);
    mkdirSync(dir, { recursive: true });
    const { html, width, height } = renderHtml(fixture.spec);
    const htmlPath = path.join(dir, "page.html");
    writeFileSync(htmlPath, html);
    writeFileSync(
      path.join(dir, "source.json"),
      `${JSON.stringify({ source: fixture.source, degradation: fixture.spec.degradation }, null, 2)}\n`,
    );

    const result = spawnSync(
      exe,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--disable-crash-reporter",
        "--disable-breakpad",
        "--allow-file-access-from-files",
        `--user-data-dir=${path.join(CACHE_DIR, "chromium-profile")}`,
        `--force-device-scale-factor=${SCALE}`,
        `--window-size=${width},${height}`,
        "--virtual-time-budget=3000",
        `--screenshot=${path.join(dir, "input.png")}`,
        pathToFileURL(htmlPath).href,
      ],
      { env: { ...process.env, TEMP: tmp, TMP: tmp }, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`Rendu échoué pour ${fixture.name} : ${result.stderr}`);
    console.log(`${fixture.name} ← ${fixture.source} (${fixture.spec.degradation}) ${width * SCALE}×${height * SCALE}`);
  }
}

main();
