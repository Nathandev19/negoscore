import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOGIN_CLAIM_TTL_MINUTES } from "@/lib/auth/login-claims";

// Mission #068, partie B — la politique de confidentialité dit ce que garde
// login_claims, pourquoi, combien de temps et comment c'est effacé.

describe("politique de confidentialité : demande de lien de connexion", () => {
  it("ce qui est gardé, pourquoi, la durée réelle et l'effacement", async () => {
    const { default: PrivacyPage } = await import("@/app/confidentialite/page");
    const html = renderToStaticMarkup(<PrivacyPage />)
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
    expect(html).toContain(
      "Demande de lien de connexion faite depuis un navigateur qui a lancé une analyse sans compte : l'adresse demandée, le jeton anonyme de ce navigateur et l'empreinte d'un code glissé dans le lien (le code lui-même n'est pas gardé) — rattacher cette analyse à ton compte, même si tu ouvres le lien dans un autre navigateur — exécution du contrat.",
    );
    expect(html).toContain(
      "Demande de lien de connexion : effacée dès que le lien sert. Sinon, elle ne sert plus au bout de 2 heures, et la purge quotidienne l'efface au plus tard le lendemain.",
    );
    // Le texte annonce 2 heures : la durée codée doit rester celle-là.
    expect(LOGIN_CLAIM_TTL_MINUTES).toBe(120);
  });
});
