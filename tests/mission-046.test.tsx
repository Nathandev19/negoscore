import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoRightNotice } from "@/components/deal-input";
import { FlashBannerView } from "@/components/flash-banner";
import { flashMessage, flashVisible, readFlash } from "@/lib/auth/flash";
import { hasNoFreeRightHint, NO_FREE_LEFT_MESSAGE, RIGHT_HINT_MAX_AGE, rightHintCookieHeader, rightView } from "@/lib/billing/right-hint";
import { clearDraft, DRAFT_TTL_MS, readDraft, saveDraft, type DraftStorage } from "@/lib/draft";
import { authTemplates } from "@/lib/email/auth-templates";
import { accountDeletionEmail, cancellationConfirmationEmail, purchaseConfirmationEmail } from "@/lib/email/templates";
import { FAQ } from "@/lib/content/home";
import { ANON_COOKIE_MAX_AGE } from "@/lib/security/request";
import nextConfig from "@/next.config";

const ROOT = process.cwd();

describe("A — le refus est connu avant la saisie", () => {
  it("visiteur sans compte dont la gratuité est prise : bloqué avant toute saisie, sans appel serveur", () => {
    expect(rightView({ refused: null, signedIn: false, account: null, anonUsed: true })).toEqual({
      blocked: true,
      message: NO_FREE_LEFT_MESSAGE,
      offerSignIn: true,
    });
    expect(rightView({ refused: null, signedIn: false, account: null, anonUsed: false })).toEqual({ blocked: false });
  });

  it("compte connecté : seule la réponse du serveur bloque ; avant elle, rien", () => {
    expect(rightView({ refused: null, signedIn: true, account: null, anonUsed: true })).toEqual({ blocked: false });
    expect(rightView({ refused: null, signedIn: true, account: { allowed: false, message: "Tu n'as plus de crédit." }, anonUsed: false })).toEqual({
      blocked: true,
      message: "Tu n'as plus de crédit.",
      offerSignIn: false,
    });
    expect(rightView({ refused: null, signedIn: true, account: { allowed: true }, anonUsed: false })).toEqual({ blocked: false });
  });

  it("un refus reçu au clic fait foi", () => {
    expect(rightView({ refused: { message: "Refus" }, signedIn: false, account: null, anonUsed: false })).toMatchObject({ blocked: true, message: "Refus" });
  });

  it("indicateur : lisible par le navigateur, sans identifiant, même durée que le jeton anonyme", () => {
    const header = rightHintCookieHeader(true);
    expect(header).toBe("ns_gratuit=utilise; Path=/; Max-Age=2592000; SameSite=Lax; Secure");
    expect(header).not.toContain("HttpOnly");
    expect(RIGHT_HINT_MAX_AGE).toBe(ANON_COOKIE_MAX_AGE);
    expect(hasNoFreeRightHint("a=1; ns_gratuit=utilise")).toBe(true);
    expect(hasNoFreeRightHint("ns_gratuit=autre")).toBe(false);
  });

  it("l'accueil reste statique : le formulaire ne lit aucune donnée serveur au rendu", () => {
    const source = readFileSync(path.join(ROOT, "components/deal-input.tsx"), "utf8");
    // Visiteur sans compte : cookie lu dans le navigateur ; seul un compte appelle /api/droits.
    expect(source).toMatch(/if \(!signedIn\) return;\s+let stale = false;\s+fetch\("\/api\/droits"/);
    expect(readFileSync(path.join(ROOT, "app/page.tsx"), "utf8")).not.toMatch(/cookies\(|headers\(|getViewer/);
  });
});

describe("A2 — le texte saisi n'est jamais perdu", () => {
  function memory(): DraftStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  }

  it("brouillon gardé, relu, effacé après une analyse réussie, ignoré au-delà de 24 h", () => {
    const store = memory();
    saveDraft("Bonjour, 2 vidéos TikTok pour 300 €", store, 1_000);
    expect(readDraft(store, 2_000)).toBe("Bonjour, 2 vidéos TikTok pour 300 €");
    expect(readDraft(store, 1_000 + DRAFT_TTL_MS + 1)).toBe("");
    // Effacé, pas seulement ignoré (mission #047, politique de confidentialité).
    expect(store.data.size).toBe(0);
    saveDraft("Bonjour, 2 vidéos TikTok pour 300 €", store, 1_000);
    clearDraft(store);
    expect(readDraft(store, 2_000)).toBe("");
  });

  it("stockage indisponible : aucune erreur", () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
      removeItem: () => {
        throw new Error("bloqué");
      },
    };
    expect(() => saveDraft("x", broken)).not.toThrow();
    expect(readDraft(broken)).toBe("");
  });

  it("un refus n'efface ni le texte ni le brouillon : seul le succès les efface", () => {
    const source = readFileSync(path.join(ROOT, "components/deal-input.tsx"), "utf8");
    expect(source.match(/clearDraft\(\)/g)).toHaveLength(1);
    expect(source).toMatch(/setRespondedAt\(Date\.now\(\)\);\s+clearDraft\(\);/);
    expect(source).not.toMatch(/setEdited\(null\)|setEdited\(""\)/);
  });
});

describe("B — sans droit, l'action principale devient « Voir les tarifs »", () => {
  it("bouton plein vers /tarifs, lien « Me connecter » pour un visiteur sans compte", () => {
    const html = renderToStaticMarkup(<NoRightNotice message={NO_FREE_LEFT_MESSAGE} offerSignIn />);
    expect(html).toContain('href="/tarifs"');
    expect(html).toContain("Voir les tarifs");
    expect(html).toContain('href="/connexion?next=%2Fanalyse"');
    expect(html).toContain("bg-marque");
    expect(renderToStaticMarkup(<NoRightNotice message="x" offerSignIn={false} />)).not.toContain("Me connecter");
  });

  it("mission #047 A1 : la phrase « Score et fourchette gratuits… » est masquée quand un refus est affiché", () => {
    const source = readFileSync(path.join(ROOT, "components/deal-input.tsx"), "utf8");
    expect(source).toContain("{note && !right.blocked ? <p");
    expect(readFileSync(path.join(ROOT, "app/page.tsx"), "utf8")).toContain('<DealInput note="Score et fourchette gratuits, sans compte.');
  });

  it("le bouton d'analyse n'est plus mis en avant sans droit", () => {
    const source = readFileSync(path.join(ROOT, "components/deal-input.tsx"), "utf8");
    expect(source).toContain('variant={right.blocked ? "outline" : "default"}');
  });
});

describe("C — confirmation de connexion et de déconnexion", () => {
  it("cookie éphémère lu, valeurs inconnues ignorées", () => {
    expect(readFlash("a=1; ns_flash=connexion")).toBe("connexion");
    expect(readFlash("ns_flash=deconnexion")).toBe("deconnexion");
    expect(readFlash("ns_flash=nina@example.com")).toBeNull();
  });

  it("message selon la page d'arrivée, jamais d'adresse email", () => {
    expect(flashMessage("connexion", "/analyse/resultat/abc").text).toContain("débloquée");
    expect(flashMessage("connexion", "/").text).toContain("analyser un deal");
    expect(flashMessage("deconnexion", "/").title).toBe("Déconnexion réussie.");
    for (const pathname of ["/", "/analyse/resultat/abc", "/historique", "/compte", "/tarifs", "/analyse"]) {
      for (const kind of ["connexion", "deconnexion"] as const) {
        expect(JSON.stringify(flashMessage(kind, pathname))).not.toMatch(/@/);
      }
    }
  });

  it("présent sur la page d'arrivée, disparu à la navigation suivante ou une fois fermé", () => {
    const flash = { pathname: "/analyse/resultat/abc" };
    expect(flashVisible(flash, "/analyse/resultat/abc", false)).toBe(true);
    expect(flashVisible(flash, "/historique", false)).toBe(false);
    expect(flashVisible(flash, "/analyse/resultat/abc", true)).toBe(false);
    expect(flashVisible(null, "/", false)).toBe(false);
  });

  it("bandeau dans le flux, fermable, sans modale", () => {
    const html = renderToStaticMarkup(<FlashBannerView message={flashMessage("connexion", "/")} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Fermer ce message"');
    expect(html).not.toMatch(/role="dialog"|aria-modal|fixed|absolute/);
  });
});

describe("D — « offre » réservé à ce que la marque propose", () => {
  it("/offres redirige définitivement vers /tarifs", async () => {
    const config = nextConfig("phase-production-build");
    const redirects = await config.redirects!();
    expect(redirects).toContainEqual({ source: "/offres", destination: "/tarifs", permanent: true });
  });

  // Formes du mot au sens commercial : ce qu'on vend. Le sens « offre d'une
  // marque » (coller l'offre, contre-offre, offre incomplète…) reste autorisé.
  const COMMERCIAL = [
    /\b(choisis|choisir|prendre|voir les|voir le détail des|passe à|passer à)\s+(une |les |des )?offres?\b/i,
    // Titre de la page des formules ; « Les offres que tu as déposées » reste au sens marque.
    />\s*Les offres\s*</,
    /\bOffres et prix\b/i,
    // Libellé de formule (« Offre : Pack Deal ») ; « Offre : 300 € » (montant de la marque) reste.
    /\bOffre\s*:\s*(Pack|Pro|Gratuit|\$\{PLAN)/,
    /\b(ton|ta|votre) offre en cours\b/i,
    /\boffre (achetée|souscrite|mise en avant|gratuite)\b/i,
    /"\/offres/,
    /title: "Offres"/,
  ];

  function productFiles(): string[] {
    const dirs = ["app", "components", "lib"];
    return dirs.flatMap((dir) =>
      readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.(tsx?|md)$/.test(e.name))
        .map((e) => path.join(e.parentPath, e.name)),
    );
  }

  it("aucune occurrence commerciale dans les pages, composants, messages et contenus", () => {
    const offenders = productFiles().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return COMMERCIAL.filter((pattern) => pattern.test(text)).map((pattern) => `${path.relative(ROOT, file)} ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it("aucune occurrence commerciale dans les emails envoyés (texte et HTML) ni dans les gabarits Supabase", () => {
    const site = "https://www.negoscore.fr";
    const date = new Date();
    const emails = [
      purchaseConfirmationEmail({ to: "a@b.fr", plan: "pro", amount: 12.99, currency: "eur", date, siteUrl: site }),
      purchaseConfirmationEmail({ to: "a@b.fr", plan: "pack", amount: null, currency: null, date, siteUrl: site }),
      cancellationConfirmationEmail({ to: "a@b.fr", endsAt: date, siteUrl: site }),
      accountDeletionEmail({ to: "a@b.fr", siteUrl: site }),
    ];
    const texts = [...emails.flatMap((e) => [e.subject, e.text, e.html ?? ""]), ...authTemplates().map((t) => t.html)];
    for (const text of texts) for (const pattern of COMMERCIAL) expect(text).not.toMatch(pattern);
    expect(emails[0].text).toContain("Formule : Pro");
  });

  it("le détecteur attrape bien les anciennes formulations", () => {
    for (const old of ["Choisis une offre pour continuer.", "<h1>Les offres</h1>", "Voir les offres", "Offre : Pack Deal", "Ton offre en cours.", 'href="/offres"']) {
      expect(COMMERCIAL.some((pattern) => pattern.test(old)), old).toBe(true);
    }
    for (const brandSense of ["Colle l'offre d'une marque", "Ta contre-offre chiffrée", "Offre à préciser", "Une offre en attente de réponse ?", "Offre : 300 €", "Les offres que tu as déposées"]) {
      expect(COMMERCIAL.some((pattern) => pattern.test(brandSense)), brandSense).toBe(false);
    }
  });
});

describe("E1 — la FAQ mentionne la relance gratuite", () => {
  it("« Combien ça coûte ? » dit la gratuité et la relance d'une analyse incomplète", () => {
    const price = FAQ.find((entry) => entry.question === "Combien ça coûte ?");
    expect(price?.answer).toContain("Ta première analyse est gratuite.");
    expect(price?.answer).toContain("relancer gratuitement une fois, dans les 14 jours");
  });
});
