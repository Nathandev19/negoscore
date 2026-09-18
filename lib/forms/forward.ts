import { cookies, headers } from "next/headers";

// Envoi sans JavaScript (mission #075) : une action serveur reçoit le
// formulaire tel que le navigateur l'envoie, et le transmet à la route
// existante, exactement comme le ferait le navigateur avec JavaScript.
//
// Pourquoi passer par la route plutôt que réécrire son travail : toutes les
// protections y sont (limitation par IP, droit d'analyser, clé d'idempotence,
// jeton anonyme, propriétaire de l'analyse). Un second chemin qui les recopie
// finirait par diverger ; celui-ci exécute le même code.

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

// Les cookies posés par la route (jeton anonyme, indicateur « gratuité
// utilisée ») sont reposés sur la réponse de l'action, avec leurs attributs.
export async function applySetCookies(response: Response): Promise<void> {
  const jar = await cookies();
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = decodeURIComponent(pair.slice(separator + 1));
    const options: {
      path?: string;
      maxAge?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "lax" | "strict" | "none";
    } = {};
    for (const attribute of attributes) {
      const [key, raw = ""] = attribute.split("=");
      const lower = key.toLowerCase();
      if (lower === "path") options.path = raw;
      else if (lower === "max-age") options.maxAge = Number(raw);
      else if (lower === "httponly") options.httpOnly = true;
      else if (lower === "secure") options.secure = true;
      else if (lower === "samesite") options.sameSite = raw.toLowerCase() as "lax" | "strict" | "none";
    }
    jar.set(name, value, options);
  }
}
