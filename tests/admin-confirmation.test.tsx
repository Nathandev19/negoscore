import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ConfirmationAdmin,
  dateSaisieLisible,
  RecapitulatifDemande,
  titreDemande,
  valeurDemande,
  type DemandeAdmin,
} from "@/components/admin/user-actions";

// Mission #145, partie B — la confirmation des actions admin.
//
// Le défaut : window.confirm("Accorder cet accès Pro offert ?") ne montrait ni
// le compte, ni la date de fin, ni le motif. Sur une page qui ressemble à
// toutes les autres fiches, il ne permettait pas de vérifier qu'on était sur le
// bon compte : le garde-fou ne gardait rien.
//
// Ce que ces tests figent : les QUATRE lignes du récapitulatif, et le fait que
// la question du navigateur ne revienne pas.

const FICHIER = readFileSync(path.join(process.cwd(), "components/admin/user-actions.tsx"), "utf8");
const PAGE = readFileSync(path.join(process.cwd(), "app/admin/users/[id]/page.tsx"), "utf8");

// Les commentaires de ce fichier citent l'ancien appel pour expliquer ce qui a
// été retiré. Les assertions portent donc sur le CODE, pas sur la prose :
// sinon « plus aucun confirm() » échouerait sur sa propre explication.
const SOURCE = FICHIER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Les formats français séparent la date de l'heure par une espace insécable :
// on la ramène à l'espace ordinaire avant de comparer (comme heure-paris).
const espaces = (valeur: string) => valeur.replace(/[\s  ]+/g, " ");

// React échappe l'apostrophe et les guillemets dans le balisage rendu.
const texte = (markup: string) =>
  markup.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&nbsp;", " ");

const rendu = (demande: DemandeAdmin, email: string | null = "creatrice@exemple.test") =>
  texte(renderToStaticMarkup(<RecapitulatifDemande demande={demande} email={email} />));

const GRANT: DemandeAdmin = {
  kind: "entitlement",
  action: "grant",
  reason: "Test créatrice pilote",
  expiresAt: "2026-10-15T14:30",
};
const REVOKE: DemandeAdmin = { kind: "entitlement", action: "revoke", reason: "Fin de la période de test", expiresAt: null };
const AJOUT: DemandeAdmin = { kind: "credits", delta: 10, reason: "Dédommagement analyse échouée" };
const RETRAIT: DemandeAdmin = { kind: "credits", delta: -2, reason: "Crédits ajoutés par erreur" };

describe("le récapitulatif montre les quatre choses à vérifier", () => {
  it("accorder Pro offert : compte, action, date de fin, motif", () => {
    const html = rendu(GRANT);
    expect(html).toContain("creatrice@exemple.test");
    expect(html).toContain("Accorder Pro offert");
    expect(html).toContain("15/10/2026 14:30");
    expect(html).toContain("Test créatrice pilote");
    // Mission #146 — l'heure est annoncée comme une heure de Paris, parce que
    // c'est désormais ainsi que le serveur la lit.
    expect(html).toContain("heure de Paris");
    expect(html).not.toContain("sans fuseau horaire");
    // Et surtout : la valeur affichée est bien celle qui sera envoyée.
    expect(html).not.toContain("2026-10-15T14:30");
  });

  // Mission #146 — la modale doit dire vrai des DEUX côtés du 25 octobre.
  it("la date affichée est celle qui sera comprise, été comme hiver", () => {
    for (const saisie of ["2026-10-20T23:59", "2026-11-01T23:59"]) {
      const html = espaces(rendu({ ...GRANT, expiresAt: saisie }));
      // Ce que la personne a tapé est ce qu'elle relit : c'est tout l'intérêt
      // d'interpréter en heure de Paris plutôt qu'en heure du serveur.
      expect(html, saisie).toContain(`${saisie.slice(8, 10)}/${saisie.slice(5, 7)}/2026 23:59`);
      expect(html, saisie).toContain("heure de Paris");
    }
  });

  it("une heure qui n'existe pas s'affiche là où elle tombera vraiment", () => {
    // 29/03/2026 : 02:00 saute à 03:00. Afficher 02:30 serait afficher une
    // heure que personne n'enregistrera.
    const html = espaces(rendu({ ...GRANT, expiresAt: "2026-03-29T02:30" }));
    expect(html).toContain("29/03/2026 03:30");
    expect(html).not.toContain("02:30");
  });

  it("accorder sans date de fin : l'absence d'échéance est écrite, pas laissée vide", () => {
    const html = rendu({ ...GRANT, expiresAt: null });
    expect(html).toContain("accès sans échéance");
    // Pas de mention de fuseau quand il n'y a aucune heure à interpréter.
    expect(html).not.toContain("sans fuseau horaire");
  });

  it("retirer l'accès offert : l'effet immédiat est annoncé", () => {
    const html = rendu(REVOKE);
    expect(html).toContain("creatrice@exemple.test");
    expect(html).toContain("Retirer l'accès Pro offert");
    expect(html).toContain("retiré immédiatement");
    expect(html).toContain("Fin de la période de test");
  });

  it("ajuster les crédits : le nombre exact et son signe", () => {
    expect(rendu(AJOUT)).toContain("+10 crédit(s)");
    expect(rendu(AJOUT)).toContain("Ajouter des crédits");
    expect(rendu(AJOUT)).toContain("Dédommagement analyse échouée");
    // Un retrait ne doit pas pouvoir passer pour un ajout : le signe est porté.
    expect(rendu(RETRAIT)).toContain("−2 crédit(s)");
    expect(rendu(RETRAIT)).toContain("Retirer des crédits");
    expect(rendu(RETRAIT)).not.toContain("+2");
  });

  it("un compte sans email le dit, au lieu d'afficher une ligne vide", () => {
    expect(rendu(AJOUT, null)).toContain("Compte sans email");
  });

  it("les quatre intitulés sont présents dans chaque récapitulatif", () => {
    for (const demande of [GRANT, REVOKE, AJOUT, RETRAIT]) {
      const html = rendu(demande);
      for (const intitule of ["Compte", "Action", "Motif", valeurDemande(demande).label]) {
        expect(html, `${titreDemande(demande)} / ${intitule}`).toContain(intitule);
      }
    }
  });

  it("la date saisie est relue en heure de Paris", () => {
    expect(espaces(dateSaisieLisible("2026-01-05T09:05"))).toBe("05/01/2026 09:05 (heure de Paris)");
    expect(espaces(dateSaisieLisible("2026-10-15T14:30:00"))).toBe("15/10/2026 14:30 (heure de Paris)");
    expect(dateSaisieLisible(null)).toContain("sans échéance");
    // Une valeur inattendue est rendue telle quelle : jamais de date inventée,
    // et surtout jamais une mention « heure de Paris » sur une heure illisible.
    expect(dateSaisieLisible("n'importe quoi")).toBe("n'importe quoi");
  });
});

describe("la question du navigateur ne revient pas", () => {
  it("plus aucun confirm() : c'est la modale de l'application qui demande", () => {
    expect(SOURCE).not.toContain("window.confirm");
    expect(SOURCE).not.toMatch(/\bconfirm\(/);
  });

  it("la boîte rendue est une modale annoncée, avec ses deux boutons", () => {
    const html = texte(
      renderToStaticMarkup(
        <ConfirmationAdmin demande={GRANT} email="creatrice@exemple.test" onAnnuler={() => {}} onConfirmer={() => {}} />,
      ),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // Le titre nomme l'action, et c'est lui qui nomme la boîte.
    expect(html).toContain('aria-labelledby="titre-confirmation-admin"');
    expect(html).toContain('id="titre-confirmation-admin"');
    expect(html).toContain("Confirmer : Accorder Pro offert");
    // Les deux boutons existent, et l'annulation n'est pas un simple lien mort.
    expect(html).toContain(">Annuler</button>");
    expect(html).toContain(">Confirmer</button>");
    // Le récapitulatif est bien DANS la boîte, pas à côté.
    expect(html).toContain("creatrice@exemple.test");
    expect(espaces(html)).toContain("15/10/2026 14:30");
    expect(html).toContain("Test créatrice pilote");
  });

  // Mesuré sur 320 × 568 avec une adresse et un motif longs : sans borne de
  // hauteur, la boîte montait à −156 px et la ligne « Compte » sortait par le
  // haut, sans défilement possible (le voile est fixe). On validait donc sans
  // pouvoir lire le compte — soit l'inverse de ce que cette modale apporte.
  it("une boîte trop haute défile au lieu de sortir de l'écran", () => {
    const html = renderToStaticMarkup(
      <ConfirmationAdmin demande={GRANT} email="x@y.fr" onAnnuler={() => {}} onConfirmer={() => {}} />,
    );
    const boite = /<div role="dialog"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(boite).toContain("overflow-y-auto");
    expect(boite).toMatch(/max-h-/);
  });

  // Mission #159 — DÉFAUT TROUVÉ EN OUVRANT LA MODALE, pas dans un test.
  //
  // À 320 × 568, avec une adresse et un motif longs, elle s'affichait déjà
  // défilée de 151 px : donner le focus au bouton « Annuler », qui est en bas,
  // faisait défiler le contenu jusqu'à lui, et le titre — la ligne qui NOMME
  // l'action qu'on s'apprête à valider — passait au-dessus du bord.
  // `preventScroll` garde le focus là où il doit être sans toucher au
  // défilement : mesuré après correction, scrollTop = 0, titre et ligne
  // « Compte » visibles d'emblée.
  it("le focus va sur Annuler SANS faire défiler la boîte", () => {
    expect(SOURCE).toMatch(/annulerRef\.current\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
    // Et c'est bien « Annuler » qui le reçoit, jamais la validation : une
    // touche Entrée réflexe doit renoncer.
    expect(SOURCE).not.toMatch(/confirmerRef|onConfirmer[^)]*\.focus\(/);
  });

  it("Échap ferme : l'écouteur est posé sur le document et retiré ensuite", () => {
    expect(SOURCE).toContain('"Escape"');
    expect(SOURCE).toContain('document.addEventListener("keydown"');
    expect(SOURCE).toContain('document.removeEventListener("keydown"');
    // Le focus va sur l'annulation, pas sur la validation : une touche Entrée
    // réflexe doit renoncer, jamais accorder un accès. Mission #159 : sans
    // faire défiler la boîte — voir le test dédié plus bas.
    expect(SOURCE).toContain("annulerRef.current?.focus(");
  });

  it("la fiche passe l'email à la modale : sans lui, le récapitulatif ne garde rien", () => {
    expect(PAGE).toContain("email={data.profile.email}");
  });
});

describe("rien d'autre ne change", () => {
  it("la même route, le même corps, le même identifiant de requête", () => {
    expect(SOURCE).toContain("`/api/admin/users/${userId}/${demande.kind}`");
    expect(SOURCE).toContain("requestId: crypto.randomUUID()");
    // Les deux corps, champ pour champ, comme avant la modale.
    expect(SOURCE).toContain("{ delta: demande.delta, reason: demande.reason }");
    expect(SOURCE).toContain("{ action: demande.action, reason: demande.reason, expiresAt: demande.expiresAt }");
    // Et les deux messages d'issue, inchangés.
    expect(SOURCE).toContain("Action enregistrée et auditée.");
    expect(SOURCE).toContain("Service indisponible.");
  });

  it("les deux actions restent celles que la base connaît", () => {
    expect(titreDemande(GRANT)).toBe("Accorder Pro offert");
    expect(titreDemande(REVOKE)).toBe("Retirer l'accès Pro offert");
    // Le corps n'invente aucune valeur d'action : grant et revoke, rien d'autre.
    const actions = [...SOURCE.matchAll(/action: "(\w+)"/g)].map((m) => m[1]);
    expect([...new Set(actions)].sort()).toEqual(["grant", "revoke"]);
  });
});
