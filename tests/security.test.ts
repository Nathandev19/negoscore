import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lockAnalysis } from "@/lib/analysis/lock";
import { safeNextPath } from "@/lib/auth/session";
import { sampleAnalysis } from "@/lib/sample-analysis";
import { hashIp, isUuid, sameToken } from "@/lib/security/request";
import { isStoragePath, newStoragePath, sniffMime, validateAnnouncedFile } from "@/lib/storage/documents";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", ".cache"].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const migrations = readdirSync(MIGRATIONS_DIR)
  .sort()
  .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8").toLowerCase() }));
const allSql = migrations.map((m) => m.sql).join("\n");

describe("contenu verrouillé et redirections", () => {
  it("retire physiquement la contre-offre et le message", () => {
    const view = lockAnalysis(sampleAnalysis);
    expect("counter_offer" in view).toBe(false);
    expect("ready_to_send_message" in view).toBe(false);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(sampleAnalysis.ready_to_send_message.text);
    for (const change of sampleAnalysis.counter_offer.changes) expect(serialized).not.toContain(change);
    expect(view.score).toEqual(sampleAnalysis.score);
    expect("counter_offer" in sampleAnalysis).toBe(true);
  });

  it("n'accepte que des chemins de retour internes", () => {
    expect(safeNextPath("/analyse/resultat/abc")).toBe("/analyse/resultat/abc");
    expect(safeNextPath("https://exemple.test")).toBe("/historique");
    expect(safeNextPath("//exemple.test")).toBe("/historique");
    expect(safeNextPath("/\\exemple.test")).toBe("/historique");
    expect(safeNextPath(null)).toBe("/historique");
  });
});

describe("hachage de l'IP", () => {
  it("ne contient jamais l'IP en clair et dépend du sel", () => {
    const hash = hashIp("203.0.113.42", "sel-a");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113.42");
    expect(hashIp("203.0.113.42", "sel-a")).toBe(hash);
    expect(hashIp("203.0.113.42", "sel-b")).not.toBe(hash);
  });

  it("refuse de hacher sans sel", () => {
    expect(() => hashIp("203.0.113.42", "")).toThrow();
  });
});

describe("dépôt de documents", () => {
  it("valide le type et la taille annoncés", () => {
    expect(validateAnnouncedFile({ kind: "photo", mime: "image/png", bytes: 1000 })).toEqual({
      kind: "photo",
      mime: "image/png",
      bytes: 1000,
    });
    expect(validateAnnouncedFile({ kind: "photo", mime: "application/pdf", bytes: 1000 })).toHaveProperty("error");
    expect(validateAnnouncedFile({ kind: "pdf", mime: "application/pdf", bytes: 11 * 1024 * 1024 })).toHaveProperty("error");
    expect(validateAnnouncedFile({ kind: "pdf", mime: "application/pdf", bytes: 0 })).toHaveProperty("error");
    expect(validateAnnouncedFile({ kind: "video", mime: "video/mp4", bytes: 10 })).toHaveProperty("error");
  });

  it("génère des chemins non devinables", () => {
    const paths = new Set(Array.from({ length: 50 }, () => newStoragePath("image/jpeg")));
    expect(paths.size).toBe(50);
    for (const p of paths) expect(isStoragePath(p)).toBe(true);
    expect(isStoragePath("../autre/fichier.png")).toBe(false);
    expect(isStoragePath("deal-documents/1.png")).toBe(false);
  });

  it("lit le vrai type dans les premiers octets", () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("compare les jetons et les identifiants sans raccourci", () => {
    expect(sameToken("abc", "abc")).toBe(true);
    expect(sameToken("abc", "abd")).toBe(false);
    expect(sameToken(null, "abc")).toBe(false);
    expect(isUuid("7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e")).toBe(true);
    expect(isUuid("1 or 1=1")).toBe(false);
  });
});

describe("migrations Supabase", () => {
  it("sont numérotées, une par fichier", () => {
    expect(migrations.map((m) => m.name)).toEqual([...migrations.map((m) => m.name)].sort());
    for (const m of migrations) expect(m.name).toMatch(/^\d{14}_[a-z_]+\.sql$/);
  });

  it.each(["profiles", "deals", "deal_documents", "analyses", "credits", "whop_events", "usage_guard"])(
    "créent la table %s avec la RLS activée",
    (table) => {
      expect(allSql).toContain(`create table public.${table} (`);
      expect(allSql).toContain(`alter table public.${table} enable row level security;`);
    },
  );

  it("limitent chaque politique à auth.uid()", () => {
    const policies = allSql.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).toContain("to authenticated");
      expect(policy).toContain("auth.uid()");
    }
  });

  it("ne donnent aucun accès client à whop_events ni à usage_guard", () => {
    expect(allSql).not.toMatch(/create policy[^;]*on public\.(whop_events|usage_guard)/);
    expect(allSql).toContain("revoke all on table public.whop_events from anon, authenticated;");
    expect(allSql).toContain("revoke all on table public.usage_guard from anon, authenticated;");
    expect(allSql).toContain("revoke all on function public.usage_guard_hit(text, int, int) from public, anon, authenticated;");
  });

  it("créent un bucket privé sans politique client", () => {
    expect(allSql).toMatch(/'deal-documents',\s*'deal-documents',\s*false/);
    expect(allSql).toContain("public = false");
    expect(allSql).not.toMatch(/create policy[^;]*storage\.objects/);
  });
});

describe("clé service_role", () => {
  const files = walk(ROOT).filter((f) => !f.includes(`${path.sep}tests`) && !f.includes(`${path.sep}evals${path.sep}`));

  it("n'est lue que par le module serveur", () => {
    const readers = files
      .filter((f) => readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(readers).toEqual(["lib/security/request.ts", "lib/supabase/server.ts"]);
  });

  it("n'est jamais importée par un composant client", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(source)) continue;
      expect(source, path.relative(ROOT, file)).not.toMatch(/@\/lib\/(supabase|security|storage)\//);
    }
  });
});
