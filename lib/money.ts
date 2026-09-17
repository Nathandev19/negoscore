// Formateur unique des montants. Toute somme affichée ou écrite dans un
// message passe par ici : même séparateur de milliers partout.

const FORMATS: Record<"fr" | "en", Intl.NumberFormat> = {
  fr: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
};

export function formatEur(value: number, language: "fr" | "en" = "fr"): string {
  return FORMATS[language].format(value);
}

export function formatEurRange(low: number | null, high: number | null, language: "fr" | "en" = "fr"): string | null {
  if (low !== null && high !== null) {
    return low === high ? formatEur(low, language) : `${formatEur(low, language)} – ${formatEur(high, language)}`;
  }
  if (low !== null) return formatEur(low, language);
  if (high !== null) return formatEur(high, language);
  return null;
}

// Nombre seul, avec exactement le séparateur de milliers de formatEur
// (« 1 100 »). Dérivé du format monétaire : le format numérique fr-FR ne groupe
// pas les nombres à quatre chiffres dans tous les moteurs (« 1070 »).
export function formatAmount(value: number): string {
  return formatEur(value).replace(/\s*€$/, "");
}
