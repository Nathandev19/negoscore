import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPTY_DASHBOARD_KEYS } from "@/lib/admin/data";

// Mission #209 bis — UNE MIGRATION QUI NE S'EXÉCUTE PAS EST PASSÉE À TRAVERS
// TOUTES LES PORTES.
//
// La migration 42 a franchi tests, build, typecheck et lint, puis Postgres l'a
// refusée à l'exécution : « ERROR: 0A000: cannot use subquery in check
// constraint ». Les tests d'alors lisaient le TEXTE du fichier — ils
// vérifiaient que la bonne liste de valeurs y figurait, pas que le moteur
// l'acceptait. Un fichier SQL qu'aucun moteur n'a jamais lu n'est pas du code
// vérifié, c'est du texte.
//
// Ce fichier-ci exécute vraiment le SQL. PGlite est PostgreSQL compilé en
// WebAssembly : pas de Docker, pas de serveur à lancer, et il refuse la
// sous-requête avec LE MÊME code d'erreur que le moteur de Supabase — vérifié
// avant d'écrire ce test, et c'est la raison pour laquelle il est ici.
//
// CE QU'IL NE COUVRE PAS, et il faut le savoir : PGlite 0.5.13 embarque
// PostgreSQL 18, pendant que Supabase sert du 15 ou du 17 selon le projet. Il
// attrape donc ce qui est refusé partout — et la règle sur les sous-requêtes
// dans un CHECK est l'une des plus anciennes du moteur — mais il ne prouve
// pas qu'une construction récente passera sur la version de Supabase. Il ne
// couvre pas non plus ce qui est propre à Supabase : schéma `auth`, rôles
// `authenticated` et `anon`, politiques RLS, extensions.
//
// C'est pour ça que les DEUX gardes de ce fichier sont nécessaires : celle qui
// exécute, limitée à ce qu'on peut monter sans Supabase, et celle qui relit
// toutes les migrations à la recherche de la même faute.

const DOSSIER = "supabase/migrations";
const MIGRATION_42 = `${DOSSIER}/20261029000042_comportement_en_page.sql`;

// Les tables que la migration 42 touche, ou que sa fonction lit. Minimales :
// seulement les colonnes citées par le SQL exécuté. Ce n'est pas le schéma de
// production et ça n'a pas à l'être — ce qu'on éprouve ici, c'est le SQL de la
// migration, pas la base.
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
  environment text not null default 'production',
  internal boolean not null default false,
  occurred_at timestamptz not null default now()
);
create table public.analysis_feedback (rating text, environment text default 'production', internal boolean default false, updated_at timestamptz default now());
create table public.purchases (amount numeric, currency text, environment text default 'production', internal boolean default false, paid_at timestamptz default now());
create table public.credits (plan text, period_end timestamptz);
create table public.admin_entitlements (entitlement text, source text, active boolean, expires_at timestamptz);
`;

const RELEVE = { scroll: "51-75", scrolled: true, dwell: "10-30s", first_action: "1-5s", input: "text" };

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SOCLE);
  // C'EST ICI QUE LE DÉFAUT AURAIT ÉTÉ ATTRAPÉ : cet appel levait
  // « cannot use subquery in check constraint ».
  await db.exec(readFileSync(MIGRATION_42, "utf8"));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// Insère un relevé et dit si la base l'a accepté.
async function accepte(metadata: unknown, event = "page_engagement"): Promise<boolean> {
  try {
    await db.query("insert into public.product_events (event_name, path, metadata) values ($1, '/', $2::jsonb)", [
      event,
      JSON.stringify(metadata),
    ]);
    return true;
  } catch {
    return false;
  }
}

describe("la migration 42 s'exécute sur un vrai moteur", () => {
  it("le moteur refuserait la première écriture, et c'est ce qu'on a vécu", async () => {
    // La garde de non-régression la plus directe : la construction qui a
    // cassé la mise en production est refusée ici, avec son code.
    const seul = await PGlite.create();
    try {
      await seul.exec("create table t (metadata jsonb not null default '{}'::jsonb);");
      let code = "";
      let message = "";
      try {
        await seul.exec(`alter table t add constraint c check (
          (select array_agg(k order by k) from jsonb_object_keys(metadata) as k) = array['a','b']
        );`);
      } catch (erreur) {
        const e = erreur as { code?: string; message?: string };
        code = e.code ?? "";
        message = e.message ?? "";
      }
      expect(code).toBe("0A000");
      expect(message).toContain("cannot use subquery in check constraint");
    } finally {
      await seul.close();
    }
  }, 60_000);

  it("LA FONCTION DU COCKPIT REND TOUTES SES CLÉS, exécutée pour de vrai", async () => {
    // `create or replace` remplace la fonction ENTIÈRE : une clé oubliée
    // effacerait un bloc de l'écran sans rien casser ailleurs. Jusqu'ici
    // c'était vérifié en comparant deux fichiers texte ; ici on appelle la
    // fonction et on lit ce qu'elle rend.
    const r = await db.query<{ m: Record<string, unknown> }>("select public.admin_dashboard_metrics() as m");
    const rendues = Object.keys(r.rows[0].m);
    for (const cle of EMPTY_DASHBOARD_KEYS) expect(rendues, cle).toContain(cle);
  });

  it("elle accepte une période, comme la route l'appelle", async () => {
    const r = await db.query<{ m: Record<string, unknown> }>(
      "select public.admin_dashboard_metrics(now() - interval '7 days') as m",
    );
    expect(Object.keys(r.rows[0].m).length).toBeGreaterThan(8);
  });
});

describe("la contrainte garde la MÊME garantie, sans sous-requête", () => {
  it("un relevé complet et valide passe", async () => {
    expect(await accepte(RELEVE)).toBe(true);
  });

  it("UNE CLÉ EN TROP est refusée — c'est par là que passerait un contenu", async () => {
    expect(await accepte({ ...RELEVE, texte: "Bonjour, on propose 300 €" })).toBe(false);
  });

  it("UNE CLÉ MANQUANTE est refusée", async () => {
    for (const cle of Object.keys(RELEVE)) {
      const partiel = { ...RELEVE } as Record<string, unknown>;
      delete partiel[cle];
      expect(await accepte(partiel), cle).toBe(false);
    }
  });

  it("un objet vide est refusé", async () => {
    expect(await accepte({})).toBe(false);
  });

  it("une valeur hors du vocabulaire est refusée, champ par champ", async () => {
    for (const patch of [
      { scroll: "42" },
      { scroll: "76-100" },
      { dwell: "3 min" },
      { dwell: "15-60s" },
      { first_action: "jamais" },
      { input: "message_de_la_marque" },
      { scrolled: "oui" },
      { scrolled: 1 },
    ]) {
      expect(await accepte({ ...RELEVE, ...patch }), JSON.stringify(patch)).toBe(false);
    }
  });

  it("UNE VALEUR JSON `null` EST REFUSÉE, et c'est le trou que l'enveloppe ferme", async () => {
    // Dans PostgreSQL, un CHECK dont l'expression vaut NULL est SATISFAIT.
    // Sans `coalesce(…, false)`, `metadata->>'scroll'` à NULL donnait
    // `NULL in (…)` à NULL, donc toute la conjonction à NULL, donc la ligne
    // passait. Ce cas-là n'aurait été attrapé par aucune relecture de texte.
    for (const cle of Object.keys(RELEVE)) {
      expect(await accepte({ ...RELEVE, [cle]: null }), cle).toBe(false);
    }
  });

  it("un relevé qui se contredit est refusé : a défilé sans aucun geste", async () => {
    expect(await accepte({ ...RELEVE, scrolled: true, first_action: "aucun" })).toBe(false);
    // L'inverse est possible : toucher le champ sans avoir défilé.
    expect(await accepte({ ...RELEVE, scrolled: false, first_action: "1-5s" })).toBe(true);
  });

  it("LES AUTRES ÉVÉNEMENTS GARDENT UN metadata LIBRE", async () => {
    // La contrainte ne doit pas se refermer sur le reste du produit :
    // negotiation_turn y écrit déjà ses propres clés.
    expect(await accepte({ turn: 3 }, "negotiation_turn")).toBe(true);
    expect(await accepte({}, "landing_view")).toBe(true);
  });
});

describe("l'agrégat compte juste, sur de vraies lignes", () => {
  beforeAll(async () => {
    await db.exec("delete from public.product_events");
    const lignes: Array<[string, Record<string, unknown>]> = [
      // Deux fermetures immédiates, sans un geste : la signature du faux trafic.
      ["paid_social", { scroll: "1-25", scrolled: false, dwell: "0-1s", first_action: "aucun", input: "aucun" }],
      ["paid_social", { scroll: "1-25", scrolled: false, dwell: "0-1s", first_action: "aucun", input: "aucun" }],
      // Une page restée ouverte sans un geste.
      ["paid_social", { scroll: "1-25", scrolled: false, dwell: "30s+", first_action: "aucun", input: "aucun" }],
      // Une lecture complète qui ne touche pas le champ.
      ["paid_social", { scroll: "90-100", scrolled: true, dwell: "10-30s", first_action: "1-5s", input: "aucun" }],
      // Un geste sur le champ SANS avoir défilé : le cas qui interdit d'en
      // faire une étape de l'entonnoir.
      ["paid_social", { scroll: "1-25", scrolled: false, dwell: "5-10s", first_action: "0-1s", input: "text" }],
      // Un autre canal, pour vérifier que le regroupement sépare.
      ["organic_social", { scroll: "90-100", scrolled: true, dwell: "30s+", first_action: "1-5s", input: "text" }],
    ];
    for (const [medium, metadata] of lignes) {
      await db.query(
        "insert into public.product_events (event_name, path, utm_medium, metadata) values ('page_engagement', '/', $1, $2::jsonb)",
        [medium, JSON.stringify(metadata)],
      );
    }
    // Une arrivée sans attribution : elle doit se ranger sous « direct ».
    await db.query(
      "insert into public.product_events (event_name, path, metadata) values ('page_engagement', '/', $1::jsonb)",
      [JSON.stringify({ scroll: "26-50", scrolled: true, dwell: "5-10s", first_action: "1-5s", input: "aucun" })],
    );
    // Et une ligne hors production, qui ne doit JAMAIS être comptée.
    await db.query(
      "insert into public.product_events (event_name, path, utm_medium, environment, metadata) values ('page_engagement', '/', 'paid_social', 'preview', $1::jsonb)",
      [JSON.stringify(RELEVE)],
    );
    // Ni une ligne interne.
    await db.query(
      "insert into public.product_events (event_name, path, utm_medium, internal, metadata) values ('page_engagement', '/', 'paid_social', true, $1::jsonb)",
      [JSON.stringify(RELEVE)],
    );
  }, 60_000);

  type Row = {
    path: string; medium: string; total: number; interacted: number; scrolled: number;
    read_to_end: number; input_touched: number; under_5s: number; idle_no_action: number;
  };

  async function engagement(): Promise<Row[]> {
    const r = await db.query<{ m: { engagement: Row[] } }>("select public.admin_dashboard_metrics() as m");
    return r.rows[0].m.engagement;
  }

  it("les compteurs du canal payant sont ceux qu'on attend", async () => {
    const paid = (await engagement()).find((row) => row.medium === "paid_social");
    expect(paid).toMatchObject({
      path: "/",
      total: 5,
      // Deux lignes portent un premier geste : la lecture complète et le
      // contact avec le champ.
      interacted: 2,
      scrolled: 1,
      read_to_end: 1,
      input_touched: 1,
      // Deux fermetures sous une seconde.
      under_5s: 2,
      // Une page restée ouverte sans un geste.
      idle_no_action: 1,
    });
  });

  it("L'ENTONNOIR NE REMONTE PAS, sur des lignes réelles", async () => {
    for (const row of await engagement()) {
      expect(row.interacted, row.medium).toBeLessThanOrEqual(row.total);
      expect(row.scrolled, row.medium).toBeLessThanOrEqual(row.interacted);
      expect(row.read_to_end, row.medium).toBeLessThanOrEqual(row.scrolled);
    }
  });

  it("une arrivée sans attribution se range sous « direct »", async () => {
    const direct = (await engagement()).find((row) => row.medium === "direct");
    expect(direct).toMatchObject({ total: 1, scrolled: 1, input_touched: 0 });
  });

  it("NI LA PRÉVISUALISATION NI LE TRAFIC INTERNE NE SONT COMPTÉS", async () => {
    const total = (await engagement()).reduce((somme, row) => somme + row.total, 0);
    // Sept lignes de production insérées, deux écartées.
    expect(total).toBe(7);
  });

  it("la distribution de la profondeur sépare les canaux et les tranches", async () => {
    const r = await db.query<{ m: { engagement_scroll: Array<{ medium: string; bucket: string; total: number }> } }>(
      "select public.admin_dashboard_metrics() as m",
    );
    const lignes = r.rows[0].m.engagement_scroll;
    expect(lignes.find((l) => l.medium === "paid_social" && l.bucket === "1-25")?.total).toBe(4);
    expect(lignes.find((l) => l.medium === "paid_social" && l.bucket === "90-100")?.total).toBe(1);
    expect(lignes.find((l) => l.medium === "organic_social" && l.bucket === "90-100")?.total).toBe(1);
  });
});

describe("la contrainte repose sur un NOT NULL, et il est là", () => {
  it("SANS `NOT NULL`, LA CONTRAINTE ENTIÈRE SERAIT CONTOURNABLE", () => {
    // Un CHECK est satisfait quand son expression vaut NULL, et la doc le dit
    // en toutes lettres : « a check constraint is satisfied if the check
    // expression evaluates to true or the null value ». Une colonne NULLable
    // laisserait donc passer une ligne dont le relevé est absent, et toute la
    // garantie de forme ne servirait plus à rien. C'est la migration 30 qui
    // tient cette base.
    // La garde est RESSERRÉE SUR LA BONNE TABLE : écrite d'abord sans
    // délimiter, elle trouvait la ligne `metadata` d'admin_entitlements et
    // passait même si product_events avait perdu son NOT NULL. La batterie de
    // mutation l'a montré en ne trouvant pas son motif.
    const trente = readFileSync(`${DOSSIER}/20260923000030_admin_cockpit.sql`, "utf8");
    const debut = trente.indexOf("create table if not exists public.product_events (");
    expect(debut).toBeGreaterThan(0);
    const table = trente.slice(debut, trente.indexOf("\n);", debut));
    expect(table).toContain("metadata jsonb not null default '{}'::jsonb");
  });

  it("le moteur refuse une ligne sans relevé du tout", async () => {
    let refuse = false;
    try {
      await db.query("insert into public.product_events (event_name, path, metadata) values ('page_engagement', '/', null)");
    } catch {
      refuse = true;
    }
    expect(refuse).toBe(true);
  });

  it("et le relevé par défaut, `{}`, est refusé par la contrainte", async () => {
    // Le défaut de la colonne est un objet vide : il ne doit pas être un
    // laissez-passer. Une ligne `page_engagement` sans relevé est un défaut
    // de mesure, pas une mesure à zéro.
    let refuse = false;
    try {
      await db.query("insert into public.product_events (event_name, path) values ('page_engagement', '/')");
    } catch {
      refuse = true;
    }
    expect(refuse).toBe(true);
  });
});
