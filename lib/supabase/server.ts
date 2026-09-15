// Accès serveur à Supabase par l'API REST (PostgREST et Storage), avec la clé
// service_role. Ce module ne doit jamais être importé par un composant client :
// la clé ne quitte pas le serveur (vérifié par tests/security.test.ts).

export const DOCUMENTS_BUCKET = "deal-documents";

export class SupabaseConfigError extends Error {}
export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

function config(): { url: string; serviceKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new SupabaseConfigError("Configuration Supabase absente");
  return { url: url.replace(/\/+$/, ""), serviceKey };
}

function authHeaders(serviceKey: string): Record<string, string> {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

async function failure(response: Response, what: string): Promise<SupabaseRequestError> {
  let code: string | null = null;
  let detail = "";
  try {
    const body = (await response.json()) as { code?: string; message?: string; error?: string };
    code = body.code ?? body.error ?? null;
    detail = body.message ?? "";
  } catch {
    // corps vide ou non JSON
  }
  // Le message ne contient ni clé ni URL signée.
  return new SupabaseRequestError(`${what} : HTTP ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`, response.status, code);
}

async function rest<T>(path: string, init: RequestInit & { what: string }): Promise<T> {
  const { url, serviceKey } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...authHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, init.what);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function insertRow<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const rows = await rest<T[]>(table, { method: "POST", body: JSON.stringify(row), what: `insertion ${table}` });
  return rows[0];
}

export async function updateRows(table: string, filter: string, patch: Record<string, unknown>): Promise<void> {
  await rest(`${table}?${filter}`, { method: "PATCH", body: JSON.stringify(patch), what: `mise à jour ${table}` });
}

export async function selectRows<T>(table: string, query: string): Promise<T[]> {
  return rest<T[]>(`${table}?${query}`, { method: "GET", what: `lecture ${table}` });
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return rest<T>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args), what: `rpc ${fn}` });
}

function objectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

// URL de dépôt signée, valable 2 heures côté Supabase. Le client y envoie le
// fichier directement : il ne transite jamais par une route de l'application.
export async function createSignedUploadUrl(path: string): Promise<string> {
  const { url, serviceKey } = config();
  const response = await fetch(`${url}/storage/v1/object/upload/sign/${DOCUMENTS_BUCKET}/${objectPath(path)}`, {
    method: "POST",
    headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "URL de dépôt signée");
  const body = (await response.json()) as { url?: string };
  if (!body.url) throw new SupabaseRequestError("URL de dépôt signée : réponse sans url", 502, null);
  return `${url}/storage/v1${body.url}`;
}

export async function downloadDocument(path: string): Promise<Uint8Array> {
  const { url, serviceKey } = config();
  const response = await fetch(`${url}/storage/v1/object/${DOCUMENTS_BUCKET}/${objectPath(path)}`, {
    headers: authHeaders(serviceKey),
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "lecture du document");
  return new Uint8Array(await response.arrayBuffer());
}

export async function removeDocument(path: string): Promise<void> {
  const { url, serviceKey } = config();
  const response = await fetch(`${url}/storage/v1/object/${DOCUMENTS_BUCKET}`, {
    method: "DELETE",
    headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "suppression du document");
}
