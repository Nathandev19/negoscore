import { getRequestUser } from "@/lib/auth/request-user";
import { DOCUMENT_TTL_DAYS, newStoragePath, validateAnnouncedFile } from "@/lib/storage/documents";
import { ANON_COOKIE, anonCookieHeader, newAnonToken, readCookie } from "@/lib/security/request";
import { createSignedUploadUrl, insertRow, SupabaseConfigError } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Prépare le dépôt d'une photo ou d'un PDF. Le fichier ne passe jamais par
// cette route : elle valide le type et la taille annoncés, crée les lignes
// deals et deal_documents, puis renvoie une URL de dépôt signée vers le
// bucket privé. Le navigateur envoie le fichier directement à Supabase.

function error(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "Requête illisible. Recharge la page et réessaie.");
  }

  const file = validateAnnouncedFile(body);
  if ("error" in file) return error(400, file.error);

  const user = await getRequestUser(request);
  const existingToken = readCookie(request, ANON_COOKIE);
  const anonToken = user ? null : (existingToken ?? newAnonToken());
  const storagePath = newStoragePath(file.mime);

  try {
    const deal = await insertRow<{ id: string }>("deals", {
      user_id: user?.id ?? null,
      anon_token: anonToken,
      source_type: file.kind === "photo" ? "image" : "pdf",
      status: "awaiting_upload",
    });
    await insertRow("deal_documents", {
      deal_id: deal.id,
      storage_path: storagePath,
      mime: file.mime,
      bytes: file.bytes,
      delete_after: new Date(Date.now() + DOCUMENT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
    const uploadUrl = await createSignedUploadUrl(storagePath);

    const headers = new Headers();
    if (anonToken && !existingToken) headers.append("Set-Cookie", anonCookieHeader(anonToken));
    return Response.json({ uploadUrl, storagePath }, { headers });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "upload_url_error",
        reason: caught instanceof SupabaseConfigError ? "missing_config" : "storage",
        detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu",
      }),
    );
    return error(503, "Le dépôt de fichier n'est pas disponible pour le moment. Colle le texte du message en attendant.");
  }
}
