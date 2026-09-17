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

// Insère la ligne si sa clé primaire n'existe pas encore, sinon ne fait rien.
export async function insertIfAbsent(table: string, row: Record<string, unknown>): Promise<void> {
  await rest(table, {
    method: "POST",
    body: JSON.stringify(row),
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    what: `insertion ${table}`,
  });
}

export async function updateRows<T = unknown>(table: string, filter: string, patch: Record<string, unknown>): Promise<T[]> {
  const rows = await rest<T[] | null>(`${table}?${filter}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    what: `mise à jour ${table}`,
  });
  return rows ?? [];
}

export async function selectRows<T>(table: string, query: string): Promise<T[]> {
  return rest<T[]>(`${table}?${query}`, { method: "GET", what: `lecture ${table}` });
}

export async function countRows(table: string, query: string): Promise<number> {
  const { url, serviceKey } = config();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "HEAD",
    headers: { ...authHeaders(serviceKey), Prefer: "count=exact" },
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, `comptage ${table}`);
  const total = response.headers.get("content-range")?.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

// Ajoute delta à une colonne entière par compare-and-swap : la mise à jour ne
// s'applique que si la valeur n'a pas changé depuis la lecture. Renvoie la
// nouvelle valeur, ou null si la condition (filtre + garde) n'est pas remplie.
export async function adjustInteger(
  table: string,
  filter: string,
  column: string,
  delta: number,
  guard: (current: number) => boolean,
): Promise<number | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await selectRows<Record<string, number>>(table, `select=${column}&${filter}&limit=1`);
    if (!row || !guard(row[column])) return null;
    const next = row[column] + delta;
    const updated = await updateRows(table, `${filter}&${column}=eq.${row[column]}`, { [column]: next });
    if (updated.length > 0) return next;
  }
  throw new SupabaseRequestError(`mise à jour concurrente ${table}.${column}`, 409, null);
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

// Supprime plusieurs objets du bucket en un appel. Storage renvoie les objets
// réellement retirés : un chemin déjà absent n'est pas une erreur.
export async function removeDocuments(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { url, serviceKey } = config();
  const response = await fetch(`${url}/storage/v1/object/${DOCUMENTS_BUCKET}`, {
    method: "DELETE",
    headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "suppression des documents");
  const removed = (await response.json().catch(() => [])) as Array<{ name?: string }>;
  return removed.map((object) => object.name ?? "").filter(Boolean);
}

export async function deleteRows(table: string, filter: string): Promise<void> {
  await rest(`${table}?${filter}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
    what: `suppression ${table}`,
  });
}

// Supprime les lignes du filtre et renvoie la valeur de `key` pour chacune,
// pour journaliser ce qui a réellement été supprimé.
export async function deleteRowsReturning(table: string, filter: string, key: string): Promise<string[]> {
  const rows = await rest<Array<Record<string, unknown>> | null>(`${table}?${filter}&select=${key}`, {
    method: "DELETE",
    what: `suppression ${table}`,
  });
  return (rows ?? []).map((row) => String(row[key]));
}

// Suppression définitive d'un utilisateur Supabase Auth (API d'administration).
export async function deleteAuthUser(userId: string): Promise<void> {
  const { url, serviceKey } = config();
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
    body: JSON.stringify({ should_soft_delete: false }),
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) throw await failure(response, "suppression de l'identité");
}
