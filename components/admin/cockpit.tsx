"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarCell, Funnel, TimeSeries } from "@/components/admin/charts";
import {
  ADMIN_PERIODS,
  dashboardTiles,
  exampleNotice,
  excludedNotice,
  internalNotice,
  share,
  tierChangesNotice,
  type AdminPeriod,
  type DashboardData,
} from "@/lib/admin/data";
import { seriesColor } from "@/lib/admin/series";
import { BRAND } from "@/lib/brand";

// Mission #132 — LE CHANGEMENT DE PÉRIODE EST FLUIDE, PAS UN RECHARGEMENT.
//
// Avant : cliquer « 7 jours » rechargeait la page entière. Écran blanc, saut,
// et le fil de la comparaison perdu — on ne voyait pas ce qui avait changé, on
// voyait un écran disparaître puis réapparaître.
//
// Ici, les graphiques RESTENT MONTÉS. Seules leurs valeurs changent, et les
// barres se déplacent vers la nouvelle hauteur (app/globals.css, .cockpit-bar).
//
// Mission #133 — ET IL EST INSTANTANÉ.
//
// #132 avait supprimé le rechargement, pas l'attente : le clic partait
// chercher les chiffres sur le réseau, et il s'écoulait 2 à 3 secondes avant
// que les barres ne bougent. La pastille répondait, l'écran se figeait, puis
// rattrapait d'un coup.
//
// Mesuré avant de corriger (app/dev/mesure-cockpit/route.dev.ts) : la RPC
// Postgres représente la totalité du temps serveur — 92 à 242 ms en local, et
// la mise en forme 0,1 ms. Les quatre périodes ensemble pèsent 6,4 ko. Il n'y
// a donc aucune raison d'attendre un réseau pour changer d'onglet : les
// QUATRE périodes sont embarquées dans le premier rendu, et le clic lit la
// mémoire.
//
// Les règles qui ne se négocient pas :
//   1. le clic affiche la période demandée TOUT DE SUITE, depuis la mémoire,
//      sans aucun appel réseau sur le chemin ;
//   2. le rafraîchissement en arrière-plan est OBLIGATOIRE : une valeur en
//      mémoire qui diverge de la base est pire qu'une valeur lente ;
//   3. si le chiffre rafraîchi est identique, rien n'est écrit : rien ne
//      bouge à l'écran pour dire que rien n'a changé ;
//   4. l'indicateur n'apparaît qu'au-delà de 400 ms — en usage normal on ne
//      le voit jamais ;
//   5. l'adresse suit (?period=…) et le retour arrière fonctionne ;
//   6. si le rafraîchissement échoue, les chiffres affichés RESTENT, avec
//      l'erreur à côté. On n'efface jamais un chiffre pour montrer une
//      erreur.

const LABELS: Record<AdminPeriod, string> = { "24h": "24 h", "7d": "7 jours", "30d": "30 jours", all: "Tout" };

// Au-delà de ce délai, et seulement au-delà, le rafraîchissement se montre.
export const SEUIL_INDICATEUR_MS = 400;

// Les chiffres déjà connus, par période. Partiel : si une des quatre RPC du
// premier rendu a échoué, sa période manque, et on le dit plutôt que de
// montrer ceux d'une autre.
export type CockpitCaches = Partial<Record<AdminPeriod, DashboardData>>;

// Deux jeux de chiffres sont « les mêmes » si leur sérialisation est
// identique : ils sortent de la même RPC et de la même mise en forme, donc
// l'ordre des clés est stable.
export function memeDonnees(connu: DashboardData | undefined, recu: DashboardData): boolean {
  return connu !== undefined && JSON.stringify(connu) === JSON.stringify(recu);
}

// Un corps de réponse n'est accepté que s'il ressemble vraiment à des chiffres
// de cockpit. Mesuré en patchant la réponse à `null` : sans ce contrôle, un
// corps inattendu effaçait l'écran. Les chiffres en mémoire valent mieux qu'un
// écran vide, donc une réponse qu'on ne reconnaît pas est traitée comme une
// panne : on garde, et on le dit.
export function estDonnees(recu: unknown): recu is DashboardData {
  if (typeof recu !== "object" || recu === null) return false;
  const candidat = recu as Partial<DashboardData>;
  return typeof candidat.counts === "object" && candidat.counts !== null && Array.isArray(candidat.timeseries);
}

// Rafraîchissement reçu. Rien n'a changé : on rend le MÊME objet, et React ne
// repasse pas par un rendu. Quelque chose a changé : la période concernée est
// remplacée, les trois autres sont intactes.
export function appliquerRafraichissement(
  caches: CockpitCaches,
  period: AdminPeriod,
  recu: DashboardData,
): CockpitCaches {
  if (memeDonnees(caches[period], recu)) return caches;
  return { ...caches, [period]: recu };
}

export function Cockpit({ initial, period: initialPeriod }: { initial: CockpitCaches; period: AdminPeriod }) {
  const [caches, setCaches] = useState<CockpitCaches>(initial);
  const [period, setPeriod] = useState(initialPeriod);
  const [erreur, setErreur] = useState<string | null>(null);
  // Vrai seulement si le rafraîchissement dépasse le seuil.
  const [lent, setLent] = useState(false);
  // La dernière demande gagne : deux clics rapides ne doivent pas laisser la
  // réponse la plus lente écraser la plus récente.
  const demande = useRef(0);

  // Rafraîchissement EN ARRIÈRE-PLAN, après l'affichage. Il ne bloque rien :
  // quand il part, les chiffres demandés sont déjà à l'écran.
  const rafraichir = useCallback(async (cible: AdminPeriod) => {
    const ticket = ++demande.current;
    const minuteur = window.setTimeout(() => {
      if (ticket === demande.current) setLent(true);
    }, SEUIL_INDICATEUR_MS);
    try {
      const response = await fetch(`/api/admin/cockpit?period=${cible}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const recu = (await response.json()) as { period: AdminPeriod; data: unknown };
      if (!estDonnees(recu.data)) throw new Error("corps inattendu");
      // Réponse d'une demande dépassée : on la jette plutôt que d'afficher des
      // chiffres qui ne correspondent plus à la pastille active.
      if (ticket !== demande.current) return;
      const recues = recu.data;
      setCaches((actuels) => appliquerRafraichissement(actuels, cible, recues));
      setErreur(null);
    } catch {
      if (ticket !== demande.current) return;
      setErreur("Les chiffres n’ont pas pu être rafraîchis. Ceux affichés sont les derniers obtenus.");
    } finally {
      window.clearTimeout(minuteur);
      if (ticket === demande.current) setLent(false);
    }
    // Aucune dépendance : la fonction n'utilise que des setters d'état et une
    // référence, tous stables. Elle peut donc servir de dépendance à l'effet
    // du retour arrière sans le relancer à chaque rendu.
  }, []);

  // Afficher une période : un changement d'état local, rien d'autre. Aucun
  // `await` avant que l'écran ne soit à jour — c'est là que se gagnent les
  // 2 à 3 secondes.
  const montrer = useCallback(
    (cible: AdminPeriod, pousser: boolean) => {
      setPeriod(cible);
      if (pousser) window.history.pushState(null, "", `/admin?period=${cible}`);
      void rafraichir(cible);
    },
    [rafraichir],
  );

  // Retour arrière du navigateur : l'adresse fait foi, et les valeurs suivent.
  // Instantané aussi : la période visée est déjà en mémoire.
  useEffect(() => {
    const onPop = () => {
      const cible = new URLSearchParams(window.location.search).get("period");
      const valide = ADMIN_PERIODS.find((p) => p === cible) ?? "7d";
      montrer(valide, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [montrer]);

  function choisir(cible: AdminPeriod) {
    if (cible === period) return;
    montrer(cible, true);
  }

  const data = caches[period];

  return (
    <div className={lent ? "cockpit-charge flex flex-col gap-10" : "flex flex-col gap-10"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-small font-semibold tracking-widest text-marque uppercase">Aujourd’hui et tendances</p>
          <h1 className="text-h1">Cockpit {BRAND.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ADMIN_PERIODS.map((p) => (
            <a
              key={p}
              href={`/admin?period=${p}`}
              onClick={(event) => {
                // Sans JavaScript — ou avec un clic du milieu, ou Ctrl —
                // le lien fait son travail normal : la page se charge.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                choisir(p);
              }}
              aria-current={p === period ? "page" : undefined}
              className={`rounded-pill border px-4 py-1.5 text-small font-semibold transition-colors ${
                p === period ? "border-encre bg-encre text-creme" : "border-filet bg-creme text-encre-douce hover:bg-filet"
              }`}
            >
              {LABELS[p]}
            </a>
          ))}
          {/* Indicateur discret, à sa place : pas de voile gris sur l'écran. En
              usage normal il reste vide, le rafraîchissement étant plus court
              que le seuil. */}
          <span role="status" aria-live="polite" className="text-xs text-attenue">
            {lent ? "Mise à jour…" : ""}
          </span>
        </div>
      </div>

      {erreur ? (
        <p role="alert" className="alert-bad">
          {erreur}
        </p>
      ) : null}

      {data ? (
        <Chiffres data={data} />
      ) : (
        // Cas rare : la RPC de cette période a échoué au premier rendu. On ne
        // montre pas les chiffres d'une autre période sous une pastille qui
        // dit celle-ci.
        <p role="status" className="text-small text-attenue">
          Les chiffres de cette période n’ont pas été chargés. Rafraîchissement en cours…
        </p>
      )}
    </div>
  );
}

// Les chiffres d'UNE période. Le composant reste monté d'une période à
// l'autre — seules ses props changent, donc les barres glissent au lieu de
// disparaître.
function Chiffres({ data }: { data: DashboardData }) {
  const tiles = dashboardTiles(data);
  const principales = tiles.filter((tile) => tile.series);
  const secondaires = tiles.filter((tile) => !tile.series);
  const maxVisites = Math.max(0, ...data.acquisition.map((row) => row.visits));
  const maxVues = Math.max(0, ...data.guides.map((row) => row.views));

  return (
    <>
      <section aria-label="Indicateurs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {principales.map((tile) => (
          <div key={tile.label} className="rounded-control border border-filet bg-creme p-5">
            <p className="flex items-center gap-2 text-small text-attenue">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: seriesColor(tile.series!) }}
              />
              {tile.label}
            </p>
            <p className={`cockpit-valeur figures mt-2.5 text-4xl ${tile.value === "0" ? "text-attenue" : "text-encre"}`}>
              {tile.value}
            </p>
            {tile.hint ? <p className="cockpit-valeur mt-1.5 text-xs text-attenue">{tile.hint}</p> : null}
          </div>
        ))}
      </section>

      <section aria-label="Autres indicateurs" className="grid gap-px overflow-hidden rounded-control border border-filet bg-filet sm:grid-cols-2 lg:grid-cols-3">
        {secondaires.map((tile) => (
          <div key={tile.label} className="bg-creme p-4">
            <p className="text-small text-attenue">{tile.label}</p>
            <p className="cockpit-valeur figures mt-1.5 text-2xl text-encre">{tile.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-w-0">
          <div className="h-[3px] rounded-[2px]" style={{ background: seriesColor("visites") }} />
          <h2 className="text-h2 mt-4">Activité</h2>
          <p className="mb-5 text-small text-attenue">
            Deux mesures d’ordres de grandeur différents : deux graphiques, jamais deux axes sur un seul.
          </p>
          <TimeSeries rows={data.timeseries} />
        </div>
        <div className="min-w-0">
          <div className="h-[3px] rounded-[2px] bg-encre" />
          <h2 className="text-h2 mt-4">Funnel agrégé</h2>
          <p className="mb-5 text-small text-attenue">
            Une seule mesure, donc une seule teinte. Le taux de passage est écrit, pas à déduire.
          </p>
          <Funnel data={data} />
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="h-[3px] rounded-[2px]" style={{ background: seriesColor("visites") }} />
          <h2 className="text-h2 mt-4 mb-4">Acquisition</h2>
          {data.acquisition.length === 0 ? (
            <p className="text-small text-attenue">Aucune attribution disponible.</p>
          ) : (
            <table className="w-full text-left text-small">
              <thead>
                <tr className="text-xs tracking-wide text-attenue uppercase">
                  <th className="pb-2.5 pr-3 font-normal">Source · campagne · contenu</th>
                  <th className="pb-2.5 pr-3 font-normal">Visites</th>
                  <th className="pb-2.5 pl-4 text-right font-normal">Analyses</th>
                  <th className="pb-2.5 pl-4 text-right font-normal">Achats</th>
                </tr>
              </thead>
              <tbody>
                {data.acquisition.map((row) => (
                  <tr key={`${row.source}/${row.campaign}/${row.content}`} className="border-t border-filet">
                    <td className="py-3.5 pr-3">
                      <strong className="text-encre">{row.source}</strong>
                      <br />
                      <span className="text-xs text-attenue">
                        {row.campaign} · {row.content}
                      </span>
                    </td>
                    <td className="w-[45%] py-3.5 pr-3">
                      <BarCell value={row.visits} max={maxVisites} />
                    </td>
                    <td className={`figures py-3.5 pl-4 text-right ${row.analyses === 0 ? "text-attenue" : ""}`}>{row.analyses}</td>
                    <td className={`figures py-3.5 pl-4 text-right ${row.purchases === 0 ? "text-attenue" : ""}`}>{row.purchases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="min-w-0">
          <div className="h-[3px] rounded-[2px] bg-encre" />
          <h2 className="text-h2 mt-4 mb-4">Feedback estimation</h2>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-control border border-filet bg-filet">
            {[
              ["Total", data.feedback.total],
              ["Juste", data.feedback.fair],
              ["Pas juste", data.feedback.not_fair],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-creme p-4">
                <p className="text-small text-attenue">{label}</p>
                <p className="cockpit-valeur figures text-2xl">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission #120 — les pages d'arrivée depuis un moteur de recherche.
          Le tableau ne s'affiche que s'il y a quelque chose à montrer. */}
      {data.guides.length > 0 || data.example.total > 0 ? (
        <section aria-label="Guides et exemple chiffré" className="min-w-0">
          <div className="h-[3px] rounded-[2px]" style={{ background: seriesColor("visites") }} />
          <h2 className="text-h2 mt-4">Guides et exemple chiffré</h2>
          <p className="mb-4 text-small text-attenue">
            Pages d’arrivée. « Vers l’exemple » compte les clics vers l’analyse complète, attribués au guide d’origine.
          </p>
          <table className="w-full text-left text-small">
            <thead>
              <tr className="text-xs tracking-wide text-attenue uppercase">
                <th className="pb-2.5 pr-3 font-normal">Page</th>
                <th className="pb-2.5 pr-3 font-normal">Vues</th>
                <th className="pb-2.5 pl-4 text-right font-normal">Vers l’exemple</th>
                <th className="pb-2.5 pl-4 text-right font-normal">Part</th>
              </tr>
            </thead>
            <tbody>
              {data.guides.map((row) => (
                <tr key={row.path} className="border-t border-filet">
                  <td className="py-3.5 pr-3 font-mono text-xs">{row.path}</td>
                  <td className="w-[45%] py-3.5 pr-3">
                    <BarCell value={row.views} max={maxVues} />
                  </td>
                  <td className={`figures py-3.5 pl-4 text-right ${row.to_example === 0 ? "text-attenue" : ""}`}>{row.to_example}</td>
                  <td className="figures py-3.5 pl-4 text-right text-attenue">{share(row.to_example, row.views) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-small text-attenue">{exampleNotice(data)}</p>
        </section>
      ) : null}

      <div className="flex flex-col gap-2">
        {/* Mission #130 — la seule trace d'un changement de niveau. L'analyse,
            elle, garde le niveau de son calcul : voir /admin/analyses. */}
        <p className="text-small text-attenue">{tierChangesNotice(data)}</p>
        <p className="text-small text-attenue">{excludedNotice(data)}</p>
        <p className="text-small text-attenue">{internalNotice(data)}</p>
        <p className="text-xs text-attenue">
          « Analyses lancées » et « Analyses terminées » sont deux compteurs bruts : aucun taux n’est calculé entre eux,
          faute d’un identifiant commun permettant de suivre une même analyse du lancement à sa fin.
        </p>
        <p className="text-xs text-attenue">
          Les visites et UTM commencent avec cette instrumentation et respectent DNT. Sans identifiant anonyme
          persistant, l’attribution est partielle. Le revenu est disponible uniquement pour les achats futurs dont Whop
          fournit montant et devise.
        </p>
      </div>
    </>
  );
}
