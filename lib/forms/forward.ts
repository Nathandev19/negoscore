import { cookies, headers } from "next/headers";

// Envoi sans JavaScript (mission #075) : une action serveur reçoit le
// formulaire tel que le navigateur l'envoie, et le transmet à la route
// existante, exactement comme le ferait le navigateur avec JavaScript.
//
// Pourquoi passer par la route plutôt que réécrire son travail : toutes les
// protections y sont (ici : le propriétaire de l'analyse). Un second chemin
// qui les recopie finirait par diverger ; celui-ci exécute le même code.
// Seul l'avis sur l'estimation passe encore par là (l'analyse sans JavaScript
// a été retirée, mission #076).

// Requête « comme venue du navigateur » : mêmes cookies, même adresse IP.
export async function forwardedJsonRequest(path: string, body: unknown): Promise<Request> {
  const jar = await cookies();
  const incoming = await headers();
  const cookieHeader = jar
    .getAll()
    .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
    .join("; ");
  const forwarded: Record<string, string> = { "content-type": "application/json" };
  if (cookieHeader) forwarded.cookie = cookieHeader;
  for (const name of ["x-forwarded-for", "x-real-ip", "user-agent"]) {
    const value = incoming.get(name);
    if (value) forwarded[name] = value;
  }
  // L'hôte ne sert qu'à former une adresse valide : la route ne le lit pas.
  return new Request(`http://localhost${path}`, { method: "POST", headers: forwarded, body: JSON.stringify(body) });
}
