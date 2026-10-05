// Une information complémentaire aux UTM : aucune adresse complète ne quitte
// cette fonction, et aucun paramètre ne peut être enregistré en base.
export function normalizeReferrer(value: string | null | undefined, siteHostname: string): string | null {
  if (value == null) return "direct";
  if (typeof value !== "string") return null;
  if (!value.trim()) return "direct";
  const raw = value.trim();
  if (raw === "direct" || raw === "interne") return raw;

  let hostname: string;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
  // Même limite et même alphabet que la contrainte SQL. Une IP ou un hôte
  // inattendu perd seulement le référent, jamais la ligne d'événement.
  if (hostname.length > 255 || !/^[a-z\d-]+(?:\.[a-z\d-]+)*$/.test(hostname)) return null;
  if (/^\d+(?:\.\d+){3}$/.test(hostname)) return null;

  const site = siteHostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (hostname === site) return "interne";
  if (hostname === "l.instagram.com" || hostname === "lm.instagram.com") return "instagram.com";
  if (hostname === "m.facebook.com" || hostname === "l.facebook.com") return "facebook.com";
  if (/^(?:[a-z\d-]+\.)*google\.[a-z]{2,}(?:\.[a-z]{2,3})?$/.test(hostname)) return "google";
  if (hostname === "t.co") return "x.com";
  return hostname;
}
