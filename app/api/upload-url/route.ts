import { ANALYSIS_PAUSED_MESSAGE, analysisPaused } from "@/lib/analysis/pause";
import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { DOCUMENT_TTL_DAYS, newStoragePath, validateAnnouncedFile } from "@/lib/storage/documents";
import { ANON_COOKIE, anonCookieHeader, clientIp, hashIp, newAnonToken, readCookie } from "@/lib/security/request";
import { UPLOAD_URLS_PER_HOUR, UPLOAD_URLS_PER_SUBJECT_PER_HOUR } from "@/lib/security/limits";
import { hitUsageGuard } from "@/lib/security/usage-guard";
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
  // Interrupteur ANALYSIS_PAUSED : aucun dépôt tant que l'analyse est coupée.
  if (analysisPaused()) return Response.json({ error: ANALYSIS_PAUSED_MESSAGE, reason: "paused" }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "Requête illisible. Recharge la page et réessaie.");
  }

  const file = validateAnnouncedFile(body);
  if ("error" in file) return error(400, file.error);

  // Mission #089 : authentification injoignable n'est pas « pas de session ».
  // On ne sait rien de la personne : on le dit, sans rien affirmer d'autre.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("upload_url");
    return error(503, "Le dépôt de fichier n'est pas disponible pour le moment. Colle le texte du message en attendant.");
  }
  const user = session.kind === "valid" ? session.user : null;
  const existingToken = readCookie(request, ANON_COOKIE);
  const anonToken = user ? null : (existingToken ?? newAnonToken());
  const storagePath = newStoragePath(file.mime);

  // Limite horaire (mission #062, B1), comptée par le mécanisme qui sert déjà
  // aux analyses. Deux clés : l'IP hachée, et le compte ou le jeton anonyme
  // quand il existe DÉJÀ — un jeton fabriqué à cette requête ne limiterait
  // rien et ajouterait une ligne de compteur à chaque appel.
  const subjectKey = user ? `upload-url:user:${user.id}` : existingToken ? `upload-url:anon:${existingToken}` : null;
  try {
    const perIp = await hitUsageGuard(hashIp(`upload-url:ip:${clientIp(request)}`), { limit: UPLOAD_URLS_PER_HOUR });
    const perSubject = subjectKey
      ? await hitUsageGuard(hashIp(subjectKey), { limit: UPLOAD_URLS_PER_SUBJECT_PER_HOUR })
      : { allowed: true, retryInMinutes: 1 };
    const blocked = !perIp.allowed ? perIp : !perSubject.allowed ? perSubject : null;
    if (blocked) {
      return error(429, `Trop de fichiers envoyés en une heure. Réessaie dans ${blocked.retryInMinutes} min.`);
    }
  } catch {
    // Compteur indisponible : on laisse passer plutôt que de couper le dépôt.
  }

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
