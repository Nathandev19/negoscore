import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";

// Mission #049 — une page de résultat qui n'est pas la tienne répond 404, et
// répond la même chose dans les trois cas : identifiant inexistant, analyse
// d'un autre, analyse supprimée. Si l'un des trois divergeait (code, page,
// nombre de lectures en base), on pourrait deviner qu'un identifiant existe.
const db = vi.hoisted(() => ({
  analyses: new Map<string, { payload: unknown; deal: Record<string, unknown> }>(),
  queries: [] as string[],
}));

const cookieJar = vi.hoisted(() => ({ anon: null as string | null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    db.queries.push(`${table}?${query}`);
    const id = query.match(/id=eq\.([^&]+)/)?.[1] ?? "";
    const row = db.analyses.get(id);
    return row ? [row] : [];
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "deal_anon_token" && cookieJar.anon ? { value: cookieJar.anon } : undefined) }),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  userFromAccessToken: async () => null,
}));

const { default: AnalysisLayout } = await import("@/app/analyse/resultat/[id]/layout");

const OWNER_TOKEN = "jeton-du-navigateur-auteur";
const OTHER_TOKEN = "jeton-d-un-autre-navigateur";
const EXISTING_ID = "11111111-1111-4111-8111-111111111111";
const DELETED_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  db.analyses.clear();
  db.queries = [];
  cookieJar.anon = OTHER_TOKEN;
  // Seule celle-ci existe, et elle appartient à un autre navigateur.
  db.analyses.set(EXISTING_ID, {
    payload: sample,
    deal: { id: "deal-1", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "offre", deal_documents: [] },
  });
  // DELETED_ID a existé : la suppression a effacé la ligne, comme MISSING_ID.
});

async function render(id: string): Promise<{ thrown: unknown; queries: number }> {
  db.queries = [];
  let thrown: unknown = null;
  try {
    await AnalysisLayout({ children: null, params: Promise.resolve({ id }) } as never);
  } catch (caught) {
    thrown = caught;
  }
  return { thrown, queries: db.queries.length };
}

function digest(thrown: unknown): string {
  return String((thrown as { digest?: string } | null)?.digest ?? thrown);
}

describe("page de résultat introuvable", () => {
  it("identifiant inexistant : notFound", async () => {
    const { thrown } = await render(MISSING_ID);
    expect(digest(thrown)).toContain("404");
  });

  it("analyse appartenant à quelqu'un d'autre : notFound", async () => {
    const { thrown } = await render(EXISTING_ID);
    expect(digest(thrown)).toContain("404");
  });

  it("analyse supprimée : notFound", async () => {
    const { thrown } = await render(DELETED_ID);
    expect(digest(thrown)).toContain("404");
  });

  it("les trois cas sont indiscernables : même erreur, même nombre de lectures", async () => {
    const missing = await render(MISSING_ID);
    const other = await render(EXISTING_ID);
    const deleted = await render(DELETED_ID);
    expect(digest(other)).toBe(digest(missing));
    expect(digest(deleted)).toBe(digest(missing));
    expect(other.queries).toBe(missing.queries);
    expect(deleted.queries).toBe(missing.queries);
  });

  it("l'analyse de son propre navigateur s'affiche", async () => {
    cookieJar.anon = OWNER_TOKEN;
    const { thrown } = await render(EXISTING_ID);
    expect(thrown).toBeNull();
  });

  // Le 404 doit rester décidé au-dessus de loading.tsx : depuis la page, il
  // arriverait après le début du streaming et la réponse serait un 200.
  it("la décision est prise dans le layout, au-dessus du squelette", () => {
    const dir = path.join(process.cwd(), "app/analyse/resultat/[id]");
    expect(readFileSync(path.join(dir, "layout.tsx"), "utf8")).toContain("notFound()");
    expect(readFileSync(path.join(dir, "loading.tsx"), "utf8")).toBeTruthy();
  });
});
