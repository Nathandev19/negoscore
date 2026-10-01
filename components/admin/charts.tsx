import { visitCount, type DashboardData } from "@/lib/admin/data";
import { seriesColor, SERIES_LABEL, type Series } from "@/lib/admin/series";

// Mission #132 — RENDRE LE COCKPIT LISIBLE.
//
// Les graphiques précédents ont produit deux erreurs de lecture réelles le
// 01/10 : une ligne de zéros prise pour une absence, et deux chiffres
// différents sous le même mot. Ce qui est corrigé ici :
//   - des barres d'un pixel dans un SVG à défilement horizontal, vide à 97 % →
//     des barres en flux, épaisses, qui s'adaptent à la plage ;
//   - une légende en PHRASE (« Bleu : visites, Brun : analyses ») où la couleur
//     portait seule l'identité → une pastille À CÔTÉ DU NOM, sur chaque
//     graphique ;
//   - deux ordres de grandeur sur un seul axe (24 contre 2) → deux graphiques
//     empilés, chacun avec son échelle. Jamais deux axes sur un graphique ;
//   - aucun taux de passage dans le funnel, la seule chose qu'on lui demande →
//     il est écrit en toutes lettres entre deux étapes ;
//   - aucune valeur au survol → un title sur chaque barre et chaque étape.
//
// Les transitions sont en CSS (app/globals.css, .cockpit-bar) : aucune
// bibliothèque de graphiques, aucune bibliothèque d'animation. Sous
// prefers-reduced-motion, elles sont désactivées.

const NUMBER = new Intl.NumberFormat("fr-FR");

// Mission #135 — LA GRADUATION HAUTE EST STRICTEMENT AU-DESSUS DU MAXIMUM.
//
// Vu à l'écran le 01/10 : sur « Visites », l'axe s'arrêtait à 18 et la barre
// montait plus haut que la ligne ; sur « Analyses », maximum 2 et graduation
// 2, la barre touchait la ligne du haut. Une donnée qui sort du cadre est une
// erreur de lecture qui attend son heure — on ne sait plus si la barre vaut
// le maximum ou le dépasse.
//
// On cherche donc le plus petit plafond PAIR, multiple d'un pas lisible, et
// strictement supérieur au maximum. Pair, pour que la graduation du milieu
// reste un entier.
const PAS_LISIBLES = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 100000] as const;

export function axisTop(max: number): number {
  // Série vide ou illisible : une échelle de 2, pour que la ligne de base et
  // la graduation du haut restent visibles.
  if (!Number.isFinite(max) || max <= 0) return 2;
  // Une marge d’au moins 8 % au-dessus du maximum : mesuré à l’écran, un
  // plafond à « maximum + 1 » laissait la barre à 5 px de la ligne du haut, et
  // on relisait « est-ce qu’elle la touche ? ». La question ne doit pas se
  // poser.
  const minimum = Math.max(max + 1, max * 1.08);
  for (const pas of PAS_LISIBLES) {
    const candidat = Math.ceil(minimum / (2 * pas)) * 2 * pas;
    // Au plus quinze pas sous le plafond : au-delà, le pas suivant donne un
    // nombre plus rond pour la même place.
    if (candidat <= 30 * pas) return candidat;
  }
  return Math.ceil(minimum / 2) * 2;
}

// Trois graduations : le plafond, sa moitié, et zéro.
export function axisTicks(max: number): number[] {
  const haut = axisTop(max);
  return [haut, haut / 2, 0];
}

const JOUR = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });

export function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : JOUR.format(date);
}

// Les dates se chevauchent au-delà d'une quinzaine de colonnes : on en affiche
// une sur deux, jamais inclinée. La DERNIÈRE est toujours montrée — c'est la
// plus récente, celle qu'on cherche.
export function labelEvery(days: number): number {
  if (days <= 10) return 1;
  if (days <= 20) return 2;
  return Math.ceil(days / 10);
}

// Mission #135 — la géométrie, en un seul endroit.
//
// HAUTEUR : la hauteur utile du graphique. Une barre ne peut jamais
// l'atteindre, puisque la graduation haute est strictement au-dessus du
// maximum (axisTop).
//
// BARRE_MAX : au-delà, une barre cesse de se lire comme une marque et devient
// un aplat. Deux jours donnent deux barres étroites bien espacées, trente
// jours trente barres fines : dans les deux cas, un graphique.
//
// ESPACE : le fond VISIBLE entre deux barres voisines. Deux pixels, et ils
// séparent des colonnes, pas des barres — c'est ce qui garantit l'écart même
// quand les barres remplissent leur colonne.
export const HAUTEUR = 150;
export const BARRE_MAX = 56;
export const ESPACE = 2;

type Jour = { day: string; value: number };

function BarChart({ series, days, total }: { series: Series; days: Jour[]; total: number }) {
  const max = Math.max(0, ...days.map((d) => d.value));
  const ticks = axisTicks(max);
  const haut = ticks[0];
  const every = labelEvery(days.length);
  const color = seriesColor(series);
  return (
    <div className="flex flex-col gap-2">
      {/* La pastille accompagne TOUJOURS le nom : la couleur ne porte jamais
          seule l'identité de la série. */}
      <p className="flex flex-wrap items-center gap-2 text-small">
        <span aria-hidden className="inline-block size-2.5 rounded-[2px]" style={{ background: color }} />
        <span className="font-semibold text-encre">{SERIES_LABEL[series]}</span>
        <span className="text-attenue">
          — {NUMBER.format(total)} sur {days.length} jour{days.length > 1 ? "s" : ""}
        </span>
      </p>
      <div className="flex gap-3">
        <div className="flex w-7 shrink-0 flex-col justify-between py-0 text-right text-xs text-attenue" style={{ height: HAUTEUR }}>
          {ticks.map((tick) => (
            <span key={tick}>{NUMBER.format(tick)}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          {/* Grille très discrète DERRIÈRE les barres : une ligne par
              graduation, posée en absolu. Pas de dégradé — le produit n'en
              a aucun, et un fond répété se décale d'un pixel selon la
              hauteur. */}
          <div className="relative flex items-end border-b border-filet" style={{ height: HAUTEUR, gap: `${ESPACE}px` }}>
            {ticks.slice(0, -1).map((tick, rang) => (
              <span
                key={tick}
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-t border-filet"
                style={{ top: `${(rang * HAUTEUR) / (ticks.length - 1 || 1)}px` }}
              />
            ))}
            {days.map((jour) => (
              /* Mission #135 — LA COLONNE ET LA BARRE SONT DEUX CHOSES.

                 Avant, la barre ÉTAIT la colonne : `flex-1` sur la barre
                 elle-même. Sur « 24 h », deux jours donnaient deux barres de
                 390 px — un aplat, plus un graphique.

                 La colonne garde sa largeur (`flex-1`) : l'axe du temps reste
                 honnête, chaque jour occupe la même place quel que soit le
                 nombre de jours. La barre, elle, est plafonnée et centrée. */
              <div key={jour.day} className="flex min-w-0 flex-1 justify-center">
                <div
                  /* cockpit-bar porte la transition de hauteur (240 ms,
                     ease-out) et son annulation sous prefers-reduced-motion. */
                  className="cockpit-bar w-full rounded-t-[4px]"
                  style={{
                    height: `${Math.round((jour.value / haut) * HAUTEUR)}px`,
                    maxWidth: `${BARRE_MAX}px`,
                    background: color,
                  }}
                  /* Survol : la date et la valeur, sans compter de pixels. */
                  title={`${dayLabel(jour.day)} : ${NUMBER.format(jour.value)}`}
                />
              </div>
            ))}
          </div>
          {/* Les dates sont posées en ABSOLU, centrées sur leur colonne. Vu à
              l'écran sur 31 jours : en flux, chaque étiquette était bornée à la
              largeur d'une colonne (12 px) et se coupait en « 0… ». Ici elle
              déborde sans pousser personne, et `labelEvery` espace assez pour
              qu'elles ne se chevauchent pas. Jamais inclinées. */}
          <div className="relative mt-2 h-4 text-xs text-attenue">
            {days.map((jour, index) => {
              const dernier = index === days.length - 1;
              // Espacement compté À REBOURS : la dernière date est toujours sur la
              // grille, donc jamais collée à la précédente.
              if ((days.length - 1 - index) % every !== 0) return null;
              // Centre de la colonne, en pourcentage de la largeur totale.
              const centre = ((index + 0.5) / days.length) * 100;
              return (
                <span
                  key={jour.day}
                  className={`absolute top-0 -translate-x-1/2 whitespace-nowrap ${dernier ? "font-semibold text-encre" : ""}`}
                  style={{ left: `${centre}%` }}
                >
                  {dayLabel(jour.day)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Les deux mesures de l'activité. Visites et analyses n'ont pas le même ordre
// de grandeur : un seul axe écraserait la petite, et deux axes sur un même
// graphique font lire un croisement qui n'existe pas.
export function TimeSeries({ rows }: { rows: DashboardData["timeseries"] }) {
  if (rows.length === 0) {
    return <p className="text-small text-attenue">Aucun événement sur cette période.</p>;
  }
  const visites = rows.map((row) => ({ day: row.day, value: row.page_views }));
  const analyses = rows.map((row) => ({ day: row.day, value: row.analyses }));
  const vides = rows.filter((row) => row.page_views === 0 && row.analyses === 0).length;
  const somme = (jours: Jour[]) => jours.reduce((sum, jour) => sum + jour.value, 0);
  return (
    <div className="flex flex-col gap-7">
      <BarChart series="visites" days={visites} total={somme(visites)} />
      <BarChart series="analyses" days={analyses} total={somme(analyses)} />
      {/* ÉTAT VIDE ET PRESQUE VIDE : un zéro doit se lire comme un zéro. La
          ligne de base reste là, les colonnes vides aussi, et cette phrase dit
          combien de jours n'ont rien produit. */}
      <p className="border-l-2 border-filet py-2 pl-3 text-xs text-attenue">
        {vides === 0
          ? `Tous les jours de la période ont de l'activité.`
          : `${NUMBER.format(vides)} jour${vides > 1 ? "s" : ""} sans activité sur la période. La ligne de base reste visible : un zéro se lit comme un zéro, pas comme un graphique cassé.`}
      </p>
    </div>
  );
}

// Largeur d'une barre, en pourcentage du maximum. Une valeur non nulle ne
// descend jamais sous 1,5 % : plus bas, elle n'est plus visible et se lit
// comme une absence. Zéro, lui, reste zéro — c'est l'erreur de lecture du
// 01/10 qu'on ne veut pas refaire dans l'autre sens.
export function largeur(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1.5, Math.round((value / max) * 1000) / 10);
}

// Accord en nombre : en français, zéro et un prennent le singulier.
function pluriel(n: number, singulier: string, pluriel_: string): string {
  return `${NUMBER.format(n)} ${Math.abs(n) >= 2 ? pluriel_ : singulier}`;
}

// Le taux de passage d'une étape à la suivante, écrit en clair : c'est la
// seule chose qu'on demande à un funnel, et il fallait la déduire de deux
// barres. null quand le dénominateur est vide — on n'écrit pas « 0 % de 0 ».
//
// Chaque étape porte DEUX noms : celui qu'elle prend comme numérateur
// (« 2 analyses ») et celui qu'elle prend comme dénominateur (« sur 2
// lancées »). C'est ce qui fait lire la phrase comme une phrase.
// Les deux formes d'un nom : singulier, pluriel.
export type Nom = readonly [string, string];

export function stepRate(current: number, next: number, numerateur: Nom, denominateur: Nom): string | null {
  if (current <= 0) return null;
  const atteint = Math.min(next, current);
  const percent = Math.round((atteint / current) * 100);
  return `${pluriel(next, numerateur[0], numerateur[1])} sur ${pluriel(current, denominateur[0], denominateur[1])} — ${percent} %`;
}

export function Funnel({ data }: { data: DashboardData }) {
  // Mission #129 — « Visites » ici et « Visites mesurées » dans les tuiles
  // doivent être le même nombre : c'est le même mot, sur le même écran.
  // Le compte vient donc de lib/admin/data.ts, pas d'une addition recopiée.
  const steps: Array<{ label: string; value: number; num: Nom; den: Nom }> = [
    { label: "Visites", value: visitCount(data), num: ["visite", "visites"], den: ["visite", "visites"] },
    { label: "Analyses lancées", value: data.counts.analysis_started ?? 0, num: ["analyse", "analyses"], den: ["lancée", "lancées"] },
    { label: "Analyses terminées", value: data.counts.analysis_completed ?? 0, num: ["terminée", "terminées"], den: ["analyse", "analyses"] },
    { label: "Inscriptions", value: data.counts.signup ?? 0, num: ["inscription", "inscriptions"], den: ["inscription", "inscriptions"] },
    { label: "Checkout", value: data.counts.checkout_started ?? 0, num: ["checkout", "checkouts"], den: ["checkout", "checkouts"] },
    { label: "Achats", value: data.counts.purchase_completed ?? 0, num: ["achat", "achats"], den: ["achat", "achats"] },
  ];
  const max = Math.max(1, ...steps.map((step) => step.value));
  // UNE SEULE MESURE, donc UNE SEULE TEINTE. Pas d'arc-en-ciel : les étapes ne
  // sont pas des séries différentes, c'est la même population qui se réduit.
  const bleu = seriesColor("visites");
  return (
    <div className="flex flex-col">
      {steps.map((step, index) => {
        const suivant = steps[index + 1];
        const taux = suivant ? stepRate(step.value, suivant.value, suivant.num, step.den) : null;
        return (
          <div key={step.label} className="flex flex-col">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-small font-medium ${step.value === 0 ? "text-attenue" : "text-encre"}`}>{step.label}</span>
              <strong className={`figures text-xl ${step.value === 0 ? "text-attenue" : "text-encre"}`}>
                {NUMBER.format(step.value)}
              </strong>
            </div>
            <div className="mt-1.5 h-5 rounded-[4px] bg-filet">
              <div
                className="cockpit-bar h-full rounded-[4px]"
                // Plancher de 1,5 % pour une valeur NON NULLE : 2 sur 100
                // ferait une barre invisible, et une étape atteinte ne doit
                // jamais se lire comme une étape vide. Zéro reste zéro : la
                // piste est là, la barre non.
                style={{ width: `${largeur(step.value, max)}%`, background: bleu }}
                title={`${step.label} : ${NUMBER.format(step.value)}`}
              />
            </div>
            {taux ? (
              <p className="my-1.5 ml-2.5 border-l border-filet py-2 pl-3 text-xs text-attenue">{taux}</p>
            ) : (
              <div className="h-5" />
            )}
          </div>
        );
      })}
      <p className="mt-3 text-xs text-attenue">
        Étapes agrégées, sans suivi individuel entre écrans : ce funnel mesure des volumes, pas une cohorte liée.
      </p>
    </div>
  );
}
// La barre derrière le chiffre, dans les tableaux. Une ligne à 12 doit se voir
// immédiatement à côté d'une ligne à 1 ; une ligne à zéro reste une ligne, pas
// une absence — c'est l'erreur de lecture du 01/10.
export function BarCell({ value, max }: { value: number; max: number }) {
  const part = largeur(value, max);
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-2.5 min-w-10 flex-1 rounded-[3px] bg-filet">
        <div
          className="cockpit-bar h-full rounded-[3px]"
          style={{ width: `${part}%`, background: seriesColor("visites") }}
        />
      </div>
      <span className={`figures w-8 shrink-0 text-right text-small ${value === 0 ? "text-attenue" : "font-semibold text-encre"}`}>
        {NUMBER.format(value)}
      </span>
    </div>
  );
}
