// Pages réservées à un compte connecté (mission #048) : proxy.ts redirige un
// visiteur sans session valide vers /connexion AVANT tout rendu. Une sous-page
// (/compte/supprimer) est couverte par le préfixe.
export const ACCOUNT_PAGES = ["/compte", "/historique", "/merci", "/resilier"] as const;

export function requiresAccount(pathname: string): boolean {
  return ACCOUNT_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}
