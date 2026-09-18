// Mission #076 — marque « JavaScript actif » posée sur <html> par un script en
// ligne dans <head> (app/layout.tsx), avant le premier affichage. globals.css
// s'en sert pour les deux attributs ci-dessous. Pas de <noscript> : voir le
// commentaire de app/layout.tsx.
export const JS_FLAG_ATTRIBUTE = "data-js";
export const JS_FLAG_SCRIPT = `document.documentElement.setAttribute("${JS_FLAG_ATTRIBUTE}","")`;

// Montré seulement sans JavaScript : <p {...WITHOUT_JS}>…</p>.
export const WITHOUT_JS = { "data-sans-js": "" } as const;
// Masqué sans JavaScript : ce qui ne fonctionne qu'avec lui.
export const WITH_JS_ONLY = { "data-avec-js": "" } as const;
