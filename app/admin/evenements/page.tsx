import type { Metadata } from "next";
import { loadRecentEvents, RECENT_EVENTS_LIMIT, type AdminEventRow } from "@/lib/admin/data";
import { heureParis, MENTION_FUSEAU } from "@/lib/admin/heure";
import { AGENT_LABEL, type AgentFamily } from "@/lib/telemetry/visiteur";

export const metadata: Metadata = { title: "Événements — cockpit", robots: { index: false, follow: false } };

// Mission #131 — VOIR LES ÉVÉNEMENTS UN PAR UN.
//
// Le cockpit ne montrait que des totaux. Le 01/10, trois questions ont coûté
// une heure chacune : « ces 17 vues de guide, robot ou gens ? », « cette
// visite, Franceska ou pas ? », « ce +1 sur dm_exemple, moi ou une
// créatrice ? ». Les trois se répondent ici en dix secondes, en lisant la
// colonne « Appareil » : quatre vues, une empreinte, c'est une personne.
//
// CE QUI N'EST PAS AFFICHÉ, ET NE PEUT PAS L'ÊTRE : l'adresse IP (jamais
// écrite nulle part), le user-agent brut (jamais écrit non plus, seule sa
// famille l'est) et le hash complet de l'empreinte (il n'existe pas : seuls
// six caractères sont calculés et conservés).
//
// Les lignes internes et hors production SONT LÀ, marquées, avec la raison de
// leur exclusion. C'est le seul moyen de vérifier que le marquage de #118 et
// le jeton de mesure de #135 font ce qu'on croit.

const RAISON: Readonly<Record<string, string>> = {
  cookie: "cookie",
  compte: "compte",
  mesure: "jeton de mesure",
};


function attribution(row: AdminEventRow): string {
  const parts = [row.utm_source, row.utm_campaign, row.utm_content].map((v) => v ?? "non_attribue");
  return parts.every((v) => v === "non_attribue") ? "non_attribue" : parts.join(" · ");
}

// « non » quand la ligne compte, la raison quand elle est écartée. Une ligne
// marquée interne SANS raison est un marquage d'avant la migration : on le dit,
// plutôt que d'inventer laquelle des trois sources l'a produite.
function interne(row: AdminEventRow): string {
  if (!row.internal) return "non";
  const raison = row.internal_reason ? RAISON[row.internal_reason] : undefined;
  return raison ?? "oui, raison inconnue";
}

export default async function AdminEvents() {
  const data = await loadRecentEvents();
  return (
    <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1">Événements</h1>
        <p className="text-small text-attenue">
          Les {RECENT_EVENTS_LIMIT} derniers, du plus récent au plus ancien. Aucun filtre : les lignes écartées du
          cockpit sont là, marquées, avec la raison de leur exclusion.
        </p>
        <p className="text-xs text-attenue">
          L’empreinte identifie un appareil pour la JOURNÉE seulement : elle est calculée avec un sel tiré au hasard
          chaque jour, et détruit ensuite. Deux jours ne peuvent pas être reliés. Aucune adresse IP n’est conservée,
          nulle part.
        </p>
      </div>

      {data === "missing" ? (
        <p role="alert" className="alert-bad">
          Les événements n’ont pas pu être lus.
        </p>
      ) : (
        <>
          {!data.detail ? (
            <p role="status" className="alert-bad">
              Migration 20261002000036 non appliquée : l’empreinte, la raison d’exclusion et la famille de navigateur
              ne sont pas encore enregistrées. Les trois colonnes correspondantes resteront vides.
            </p>
          ) : null}
          {data.rows.length === 0 ? (
            <p className="text-small text-attenue">Aucun événement.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-small">
                <thead>
                  <tr className="text-xs tracking-wide text-attenue uppercase">
                    {/* Mission #140 — le fuseau est écrit, une fois, dans
                        l'en-tête. Les journaux Vercel et les DM auxquels on
                        compare ces lignes sont en heure de Paris ; le serveur,
                        lui, tourne en UTC. */}
                    <th className="pb-2.5 pr-4 font-normal">Date et heure ({MENTION_FUSEAU})</th>
                    <th className="pb-2.5 pr-4 font-normal">Appareil</th>
                    <th className="pb-2.5 pr-4 font-normal">Événement</th>
                    <th className="pb-2.5 pr-4 font-normal">Page</th>
                    <th className="pb-2.5 pr-4 font-normal">Source · campagne · contenu</th>
                    <th className="pb-2.5 pr-4 font-normal">Interne</th>
                    <th className="pb-2.5 font-normal">Navigateur</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id} className={`border-t border-filet ${row.internal ? "text-attenue" : ""}`}>
                      <td className="figures py-3 pr-4 whitespace-nowrap">{heureParis(row.occurred_at)}</td>
                      {/* Six caractères, en chasse fixe : deux lignes du même
                          appareil se repèrent d'un coup d'œil. */}
                      <td className="py-3 pr-4 font-mono text-xs">{row.visitor ?? "—"}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">{row.event_name}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{row.path ?? "—"}</td>
                      <td className="py-3 pr-4 text-xs">{attribution(row)}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        {interne(row)}
                        {row.environment && row.environment !== "production" ? ` · ${row.environment}` : ""}
                      </td>
                      <td className="py-3 whitespace-nowrap">
                        {row.agent_family ? (AGENT_LABEL[row.agent_family as AgentFamily] ?? row.agent_family) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
