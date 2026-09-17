import { cookies } from "next/headers";
import { HeaderNav } from "@/components/header-nav";
import { ACCESS_COOKIE, emailFromAccessToken, REFRESH_COOKIE } from "@/lib/auth/session";

// Rendu serveur, sans appel réseau : la présence des cookies de session suffit
// à choisir les liens. Le proxy a déjà rafraîchi un jeton expiré, ou effacé
// une session invalide, avant ce rendu.
export async function SiteHeader() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  const signedIn = Boolean(accessToken || store.get(REFRESH_COOKIE)?.value);
  return <HeaderNav signedIn={signedIn} email={accessToken ? emailFromAccessToken(accessToken) : null} />;
}
