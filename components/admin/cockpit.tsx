"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
// Quatre règles qui ne se négocient pas :
//   1. jamais d'écran vide : les données précédentes restent affichées pendant
//      le chargement, avec un retrait d'opacité et un mot discret ;
//   2. le bouton cliqué devient actif IMMÉDIATEMENT, avant la réponse ;
//   3. l'adresse suit (?period=…), pour qu'on puisse la copier et revenir en
//      arrière avec le navigateur ;
//   4. si la requête échoue, les chiffres PRÉCÉDENTS restent, avec l'erreur à
//      côté. On n'efface jamais un chiffre pour montrer une erreur.

const LABELS: Record<AdminPeriod, string> = { "24h": "24 h", "7d": "7 jours", "30d": "30 jours", all: "Tout" };

export function Cockpit({ initial, period: initialPeriod }: { initial: DashboardData; period: AdminPeriod }) {
  const [data, setData] = useState(initial);
  const [period, setPeriod] = useState(initialPeriod);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, demarrer] = useTransition();
  // La dernière demande gagne : deux clics rapides ne doivent pas laisser la
  // réponse la plus lente écraser la plus récente.
  const demande = useRef(0);

  // Retour arrière du navigateur : l'adresse fait foi, et les valeurs suivent.
  useEffect(() => {
    const onPop = () => {
      const cible = new URLSearchParams(window.location.search).get("period");
      const valide = ADMIN_PERIODS.find((p) => p === cible) ?? "7d";
      setPeriod(valide);
      void charger(valide, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function charger(cible: AdminPeriod, pousser: boolean) {
    const ticket = ++demande.current;
    if (pousser) {
      window.history.pushState(null, "", `/admin?period=${cible}`);
    }
    try {
      const response = await fetch(`/api/admin/cockpit?period=${cible}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const recu = (await response.json()) as { period: AdminPeriod; data: DashboardData };
      // Réponse d'une demande dépassée : on la jette plutôt que d'afficher des
      // chiffres qui ne correspondent plus au bouton actif.
      if (ticket !== demande.current) return;
      demarrer(() => {
        setData(recu.data);
        setErreur(null);
      });
    } catch {
      if (ticket !== demande.current) return;
      setErreur("Les chiffres n’ont pas pu être rechargés. Ceux affichés sont ceux de la période précédente.");
    }
  }

  function choisir(cible: AdminPeriod) {
    if (cible === period) return;
    // L'état actif part AVANT la réponse : le bouton répond au doigt.
    setPeriod(cible);
    void charger(cible, true);
  }

  const tiles = dashboardTiles(data);
  const principales = tiles.filter((tile) => tile.series);
  const secondaires = tiles.filter((tile) => !tile.series);
  const maxVisites = Math.max(0, ...data.acquisition.map((row) => row.visits));
  const maxVues = Math.max(0, ...data.guides.map((row) => row.views));

  return (
    <div className={charge ? "cockpit-charge flex flex-col gap-10" : "flex flex-col gap-10"}>
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
          {/* Indicateur discret, à sa place : pas de voile gris sur l'écran. */}
          <span role="status" aria-live="polite" className="text-xs text-attenue">
            {charge ? "Mise à jour…" : ""}
          </span>
        </div>
      </div>

      {erreur ? (
        <p role="alert" className="alert-bad">
          {erreur}
        </p>
      ) : null}

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
                  <th className="pb-2.5 font-normal">Source · campagne · contenu</th>
                  <th className="pb-2.5 font-normal">Visites</th>
                  <th className="pb-2.5 text-right font-normal">Analyses</th>
                  <th className="pb-2.5 text-right font-normal">Achats</th>
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
                    <td className={`figures py-3.5 text-right ${row.analyses === 0 ? "text-attenue" : ""}`}>{row.analyses}</td>
                    <td className={`figures py-3.5 text-right ${row.purchases === 0 ? "text-attenue" : ""}`}>{row.purchases}</td>
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
                <th className="pb-2.5 font-normal">Page</th>
                <th className="pb-2.5 font-normal">Vues</th>
                <th className="pb-2.5 text-right font-normal">Vers l’exemple</th>
                <th className="pb-2.5 text-right font-normal">Part</th>
              </tr>
            </thead>
            <tbody>
              {data.guides.map((row) => (
                <tr key={row.path} className="border-t border-filet">
                  <td className="py-3.5 pr-3 font-mono text-xs">{row.path}</td>
                  <td className="w-[45%] py-3.5 pr-3">
                    <BarCell value={row.views} max={maxVues} />
                  </td>
                  <td className={`figures py-3.5 text-right ${row.to_example === 0 ? "text-attenue" : ""}`}>{row.to_example}</td>
                  <td className="figures py-3.5 text-right text-attenue">{share(row.to_example, row.views) ?? "—"}</td>
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
    </div>
  );
}
