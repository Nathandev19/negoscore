import { afterAll, describe, expect, it } from "vitest";
import { configured, createUser, deleteUser, service, type TestUser } from "./helpers";

// Lien magique au format token_hash, vérifié par le vrai Supabase Auth. Le lien
// est généré par l'API d'administration : aucun email n'est envoyé. La requête
// ne porte aucun cookie : c'est le cas d'un lien ouvert dans un autre navigateur.

const { GET: confirm } = await import("@/app/auth/confirm/route");
const { getRequestUser } = await import("@/lib/auth/request-user");

const users: TestUser[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user);
});

async function magicLinkHash(email: string): Promise<string> {
  const generated = await service("/auth/v1/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  expect(generated.status, "génération du lien").toBe(200);
  const body = generated.body as { hashed_token?: string; properties?: { hashed_token?: string } };
  const hash = body.properties?.hashed_token ?? body.hashed_token;
  expect(hash).toBeTruthy();
  return hash as string;
}

function open(query: string) {
  return confirm(new Request(`http://localhost:3000/auth/confirm?${query}`));
}

describe.skipIf(!configured)("/auth/confirm contre Supabase", () => {
  it("un lien neuf ouvert sans aucun cookie ouvre une session, puis ne sert qu'une fois", async () => {
    const user = await createUser();
    users.push(user);
    const hash = await magicLinkHash(user.email);

    const response = await open(`token_hash=${encodeURIComponent(hash)}&type=email&next=%2Fhistorique`);
    expect(response.headers.get("location")).toBe("/historique?connexion=ok");
    const access = response.headers
      .getSetCookie()
      .find((c) => c.startsWith("sb_access_token="))
      ?.split(";")[0]
      .slice("sb_access_token=".length);
    expect(access).toBeTruthy();
    const viewer = await getRequestUser(new Request("http://localhost", { headers: { cookie: `sb_access_token=${access}` } }));
    expect(viewer?.id).toBe(user.id);

    // Jeton à usage unique : un second passage (scanner, double clic) échoue proprement.
    const again = await open(`token_hash=${encodeURIComponent(hash)}&type=email&next=%2Fhistorique`);
    expect(again.headers.get("location")).toBe("/connexion?erreur=lien&next=%2Fhistorique");
    expect(again.headers.getSetCookie()).toEqual([]);
  });

  it("un jeton inventé est refusé sans session", async () => {
    const response = await open("token_hash=faux-jeton&type=email");
    expect(response.headers.get("location")).toBe("/connexion?erreur=lien&next=%2Fcompte");
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
