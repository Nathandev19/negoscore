import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ROBOT_REASONS } from "@/lib/analytics/robot-visite";

// Mission #213 — LE CLASSEMENT, ÉPROUVÉ SUR UN VRAI MOTEUR.
//
// Deux choses que seule une exécution peut établir, et qu'aucune relecture de
// texte n'aurait établies (c'est la leçon de la #209 bis : une migration qui
// ne s'exécute pas a franchi tests, build, typecheck et lint) :
//
//   1. les contraintes refusent ce qu'elles prétendent refuser — vocabulaire
//      fermé, cohérence dans les deux sens, et un User-Agent brut qui ne peut
//      PAS entrer dans agent_signature ;
//   2. une ligne marquée robot sort des compteurs ET reste comptée à part.
//      C'est toute la demande de la mission : séparer, pas supprimer.
//
// PGlite est PostgreSQL compilé en WebAssembly, épinglé sur 0.4.6 (17.5) ;
// l'écart avec la production (17.6) est documenté dans
// tests/migrations-moteur.test.ts.

const DOSSIER = "supabase/migrations";
const MIGRATION_42 = `${DOSSIER}/20261029000042_comportement_en_page.sql`;
const MIGRATION_43 = `${DOSSIER}/20261114000043_robots_separes.sql`;

// Le socle minimal : seulement ce que le SQL exécuté touche ou lit.
const SOCLE = `
create table public.product_events (
  id bigserial primary key,
  event_name text not null,
  user_id uuid,
  path text,
  referrer_host text,
  referrer_domain text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  entity_type text, entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  -- Les trois colonnes de diagnostic de la #131, que la purge de 7 jours
  -- efface : il faut les avoir ici pour éprouver son interaction avec la
  -- contrainte de la 43.
  visitor text,
  internal_reason text,
  agent_family text,
  environment text not null default 'production',
  internal boolean not null default false,
  occurred_at timestamptz not null default now()
);
create index product_events_time_idx on public.product_events (occurred_at desc);
create table public.analysis_feedback (rating text, environment text default 'production', internal boolean default false, updated_at timestamptz default now());
create table public.purchases (amount numeric, currency text, environment text default 'production', internal boolean default false, paid_at timestamptz default now());
create table public.credits (plan text, period_end timestamptz);
create table public.admin_entitlements (entitlement text, source text, active boolean, expires_at timestamptz);
`;

const UA_BRUT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

type Metriques = {
  counts: Record<string, number>;
  excluded: number;
  internal: number;
  robots: { visits: number; reasons: Array<{ reason: string; visits: number }> };
  agents: Array<{ signature: string; robot: boolean; visits: number }>;
  acquisition: Array<{ source: string; content: string; visits: number }>;
  timeseries: Array<{ day: string; page_views: number }>;
};

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SOCLE);
  await db.exec(readFileSync(MIGRATION_42, "utf8"));
  // C'EST ICI QU'UNE MIGRATION QUI NE S'EXÉCUTE PAS SE VERRAIT.
  await db.exec(readFileSync(MIGRATION_43, "utf8"));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("truncate public.product_events;");
});

// Insère une ligne et dit si la base l'a acceptée.
async function accepte(colonnes: Record<string, unknown>): Promise<boolean> {
  const noms = Object.keys(colonnes);
  const valeurs = Object.values(colonnes);
  const trous = noms.map((_, i) => `$${i + 1}`).join(", ");
  try {
    await db.query(
      `insert into public.product_events (event_name, path, ${noms.join(", ")}) values ('landing_view', '/', ${trous})`,
      valeurs,
    );
    return true;
  } catch {
    return false;
  }
}

async function poser(row: {
  event?: string; source?: string | null; content?: string | null;
  robot?: boolean; reason?: string | null; signature?: string | null;
  environment?: string; internal?: boolean;
}): Promise<void> {
  await db.query(
    `insert into public.product_events
       (event_name, path, utm_source, utm_medium, utm_campaign, utm_content,
        robot, robot_reason, agent_signature, environment, internal)
     values ($1, '/', $2, 'dm', 'lancement', $3, $4, $5, $6, $7, $8)`,
    [
      row.event ?? "landing_view", row.source ?? null, row.content ?? null,
      row.robot ?? false, row.reason ?? null, row.signature ?? null,
      row.environment ?? "production", row.internal ?? false,
    ],
  );
}

const metriques = async (): Promise<Metriques> =>
  (await db.query<{ m: Metriques }>("select public.admin_dashboard_metrics() as m")).rows[0].m;

describe("les contraintes refusent ce qu'elles prétendent refuser", () => {
  it("les cinq raisons du code sont acceptées par la base, une par une", async () => {
    // Le vocabulaire est écrit DEUX fois — dans le type et dans le CHECK — et
    // ces deux-là peuvent diverger sans que rien ne casse avant la
    // production. Ce test est le seul endroit qui les compare.
    for (const reason of ROBOT_REASONS) {
      expect(await accepte({ robot: true, robot_reason: reason }), reason).toBe(true);
    }
  });

  it("une raison inventée est refusée", async () => {
    for (const reason of ["comportement", "bot", "DECLARE", ""]) {
      expect(await accepte({ robot: true, robot_reason: reason }), reason).toBe(false);
    }
  });

  it("UN VERDICT SANS RAISON EST REFUSÉ, et c'est le trou des CHECK à NULL", async () => {
    // Dans PostgreSQL, un CHECK dont l'expression vaut NULL est SATISFAIT.
    // Sans l'enveloppe `coalesce(…, false)`, `robot_reason in (…)` à NULL
    // laissait passer n'importe quoi. Trou trouvé en #209 bis, refermé ici.
    expect(await accepte({ robot: true, robot_reason: null })).toBe(false);
  });

  it("UNE RAISON SANS VERDICT EST REFUSÉE AUSSI : la cohérence va dans les deux sens", async () => {
    // Une ligne « pas robot, raison declare » serait comptée comme humaine
    // tout en portant l'explication de son exclusion. Personne ne pourrait
    // la lire.
    expect(await accepte({ robot: false, robot_reason: "declare" })).toBe(false);
  });

  it("une ligne humaine sans raison passe, et c'est le cas courant", async () => {
    expect(await accepte({ robot: false, robot_reason: null })).toBe(true);
  });

  it("LE User-Agent BRUT NE PEUT PAS ENTRER DANS agent_signature", async () => {
    // Garanti par la BASE, pas par la relecture du code : toute chaîne
    // User-Agent réelle contient des espaces, et la contrainte les refuse.
    expect(await accepte({ agent_signature: UA_BRUT })).toBe(false);
    expect(await accepte({ agent_signature: "chrome 141|windows|bureau" })).toBe(false);
    expect(await accepte({ agent_signature: "x".repeat(61) })).toBe(false);
    // Et une forme sans ses trois parties n'est pas une forme.
    expect(await accepte({ agent_signature: "chrome-141|windows" })).toBe(false);
    expect(await accepte({ agent_signature: "chrome-141|windows|bureau|extra" })).toBe(false);
  });

  it("une forme d'agent valide passe, et l'absence de forme aussi", async () => {
    expect(await accepte({ agent_signature: "chrome-141|windows|bureau" })).toBe(true);
    expect(await accepte({ agent_signature: "instagram-139|android|mobile" })).toBe(true);
    expect(await accepte({ agent_signature: null })).toBe(true);
  });

  it("une ligne déjà en base reste humaine : la colonne a un défaut", async () => {
    // Aucune ligne n'est réécrite. Ce que ça veut dire sans détour : la
    // fenêtre du 11 au 14/11 restera surestimée à l'écran.
    await db.exec("insert into public.product_events (event_name, path) values ('landing_view', '/');");
    const r = await db.query<{ robot: boolean; robot_reason: string | null }>(
      "select robot, robot_reason from public.product_events",
    );
    expect(r.rows[0]).toEqual({ robot: false, robot_reason: null });
  });
});

describe("SÉPARER, PAS SUPPRIMER", () => {
  beforeEach(async () => {
    // Le constat, en miniature : 3 visites humaines sur trois canaux réels,
    // 8 visites de robots qui annoncent Chrome, toutes sans attribution.
    await poser({ source: "tiktok", content: "bio_tiktok", signature: "safari-17|ios|mobile" });
    await poser({ source: "instagram", content: "bio_instagram", signature: "safari-17|ios|mobile" });
    await poser({ source: "instagram", content: "dm_prospection", signature: "instagram-139|android|mobile" });
    for (let i = 0; i < 8; i++) {
      await poser({ robot: true, reason: "sans_indices", signature: "chrome-141|windows|bureau" });
    }
    // Et une exploration de Googlebot, qui laisse maintenant une trace.
    await poser({ robot: true, reason: "declare", signature: "robot-x|linux|bureau" });
  });

  it("LA LIGNE RESTE EN BASE : rien n'est supprimé", async () => {
    const r = await db.query<{ total: number }>("select count(*)::int as total from public.product_events");
    expect(r.rows[0].total).toBe(12);
  });

  it("les visites humaines ne comptent que les humains", async () => {
    const m = await metriques();
    expect(m.counts.landing_view).toBe(3);
  });

  it("LES DEUX NOMBRES SONT RENDUS, et le second dit pourquoi", async () => {
    const m = await metriques();
    expect(m.robots.visits).toBe(9);
    expect(m.robots.reasons).toEqual([
      { reason: "sans_indices", visits: 8 },
      { reason: "declare", visits: 1 },
    ]);
  });

  it("un robot ne gonfle NI le tableau par source NI la courbe", async () => {
    const m = await metriques();
    // Les robots arrivent sans attribution : s'ils étaient comptés, une ligne
    // « non_attribue » à 9 visites écraserait les trois vraies.
    expect(m.acquisition.map((l) => l.source).sort()).toEqual(["instagram", "instagram", "tiktok"]);
    expect(m.acquisition.every((l) => l.visits === 1)).toBe(true);
    expect(m.timeseries.reduce((s, j) => s + j.page_views, 0)).toBe(3);
  });

  it("LES TROIS COMPTEURS D'EXCLUSION RESTENT DISJOINTS", async () => {
    // `excluded` (hors production), `internal` (le propriétaire) et `robots`
    // ne doivent jamais compter la même ligne deux fois : la #118 l'a établi
    // pour les deux premiers, le troisième ne doit pas le défaire.
    await poser({ robot: true, reason: "declare", environment: "preview" });
    await poser({ robot: true, reason: "declare", internal: true });
    const m = await metriques();
    expect(m.excluded).toBe(1);
    expect(m.internal).toBe(1);
    // Toujours 9 : ni la ligne de prévisualisation ni l'interne n'y entrent.
    expect(m.robots.visits).toBe(9);
  });

  it("LA FORME D'AGENT TRANCHE : une seule porte presque tout le trafic", async () => {
    // C'est ce que la mission demande d'enregistrer, et voilà à quoi ça sert.
    // `visitor` change à chaque visite d'un client qui tourne ses adresses :
    // huit visites ressemblaient à huit personnes. Une seule forme d'agent
    // portant huit des neuf visites écartées ne ressemble à personne.
    const m = await metriques();
    const chrome = m.agents.find((a) => a.signature === "chrome-141|windows|bureau");
    expect(chrome).toEqual({ signature: "chrome-141|windows|bureau", robot: true, visits: 8 });
    // Et les humains sont dans la même liste, avec la colonne qui le dit.
    expect(m.agents.filter((a) => !a.robot).map((a) => a.visits).sort()).toEqual([1, 2]);
  });

  it("LE RELEVÉ DE COMPORTEMENT D'UN ROBOT SORT AUSSI DES COMPTEURS", async () => {
    // Sinon le bloc « comportement en page » de la #209 continuerait de dire
    // « 0 défilement sur 26 pages vues », et la page aurait l'air en cause.
    await db.query(
      `insert into public.product_events (event_name, path, utm_medium, robot, robot_reason, metadata)
       values ('page_engagement', '/', 'dm', true, 'sans_indices',
               '{"scroll":"0","scrolled":false,"dwell":"0-1s","first_action":"aucun","input":"aucun"}'::jsonb)`,
    );
    const m = await metriques();
    expect(m.counts.page_engagement ?? 0).toBe(0);
    // Il est quand même compté comme robot écarté — mais pas comme VISITE :
    // un relevé n'est pas une arrivée, et le nombre resterait incomparable.
    expect(m.robots.visits).toBe(9);
  });
});

describe("la purge du diagnostic ne se casse pas sur une ligne de robot", () => {
  it("EFFACER L'EMPREINTE D'UNE LIGNE ROBOT RÉUSSIT", async () => {
    // Le risque que la contrainte de cohérence crée, et qu'il fallait
    // éprouver : la purge de 7 jours met visitor, internal_reason,
    // agent_family et agent_signature à null sur des lignes QUI RESTENT. Si
    // elle avait touché robot_reason, la contrainte aurait refusé la mise à
    // jour — et c'est TOUTE la purge du diagnostic qui aurait échoué, en
    // silence, sur la première ligne de robot rencontrée.
    await poser({ robot: true, reason: "declare", signature: "robot-x|linux|bureau" });
    await db.exec(`update public.product_events
      set visitor = null, internal_reason = null, agent_family = null, agent_signature = null`);
    const r = await db.query<{ robot: boolean; robot_reason: string; agent_signature: string | null }>(
      "select robot, robot_reason, agent_signature from public.product_events",
    );
    // La forme d'agent est partie, le verdict et sa raison sont restés.
    expect(r.rows[0]).toEqual({ robot: true, robot_reason: "declare", agent_signature: null });
  });

  it("EFFACER LA RAISON D'UNE LIGNE ROBOT ÉCHOUE, et c'est voulu", async () => {
    // L'autre moitié de la même garde : si quelqu'un ajoute `robot_reason`
    // à la purge demain, il doit l'apprendre par un test, pas par une purge
    // qui s'arrête en production.
    await poser({ robot: true, reason: "declare" });
    await expect(db.exec("update public.product_events set robot_reason = null")).rejects.toThrow();
  });
});

describe("la fonction rend toujours tout ce que le cockpit lit", () => {
  it("les clés de la migration 42 survivent au create or replace de la 43", async () => {
    const { EMPTY_DASHBOARD_KEYS } = await import("@/lib/admin/data");
    const r = await db.query<{ m: Record<string, unknown> }>("select public.admin_dashboard_metrics() as m");
    const rendues = Object.keys(r.rows[0].m);
    for (const cle of EMPTY_DASHBOARD_KEYS) expect(rendues, cle).toContain(cle);
  });

  it("elle accepte une période, comme la route l'appelle", async () => {
    const r = await db.query<{ m: Metriques }>(
      "select public.admin_dashboard_metrics(now() - interval '7 days') as m",
    );
    expect(r.rows[0].m.robots.visits).toBe(0);
    expect(r.rows[0].m.agents).toEqual([]);
  });
});
