"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { dateHeureParis, instantDepuisParis, MENTION_FUSEAU } from "@/lib/admin/heure";

// Mission #145 — LE GARDE-FOU QUI MONTRE CE QU'IL GARDE.
//
// Avant : window.confirm("Accorder cet accès Pro offert ?"). La question ne
// portait ni le compte, ni la date de fin, ni le motif saisi. Sur une page qui
// ressemble à toutes les autres fiches utilisateur, elle ne permettait pas de
// vérifier qu'on était sur le bon compte — c'est-à-dire qu'elle ne gardait
// rien. Un clic de trop sur la mauvaise fiche passait.
//
// Maintenant : une modale de l'application, qui récapitule les quatre choses
// à vérifier avant de valider — le compte, l'action, la valeur exacte, le
// motif. Annulation explicite, fermeture au clavier.
//
// CE QUI NE CHANGE PAS : l'appel, le corps envoyé, l'identifiant de requête
// tiré au moment de l'envoi, l'audit côté base. La modale ne fait que
// remplacer la question du navigateur.

// La demande en attente de confirmation. Elle porte exactement ce qui partira
// dans le corps : le récapitulatif ne peut donc pas décrire autre chose que ce
// qui sera envoyé.
export type DemandeAdmin =
  | { kind: "entitlement"; action: "grant"; reason: string; expiresAt: string | null }
  | { kind: "entitlement"; action: "revoke"; reason: string; expiresAt: null }
  | { kind: "credits"; delta: number; reason: string };

// L'action demandée, en français, telle qu'elle s'affiche en titre de modale.
export function titreDemande(demande: DemandeAdmin): string {
  if (demande.kind === "credits") return demande.delta > 0 ? "Ajouter des crédits" : "Retirer des crédits";
  return demande.action === "grant" ? "Accorder Pro offert" : "Retirer l'accès Pro offert";
}

// La date saisie dans le champ, affichée TELLE QU'ELLE SERA COMPRISE.
//
// Le champ est un datetime-local : sa valeur (« 2026-10-15T14:30 ») ne porte
// aucun fuseau. Depuis la mission #146, le serveur la lit comme une heure
// d'Europe/Paris — comme tout le reste de /admin depuis la #140. La modale
// refait donc exactement la même lecture, puis réaffiche l'instant obtenu en
// heure de Paris : ce qui est écrit ici est ce qui sera enregistré.
//
// Ce n'est pas un simple recopiage des chiffres saisis. Une heure qui n'existe
// pas — 02:30 le matin du passage à l'heure d'été — s'affiche 03:30, c'est-à-
// dire là où elle tombera vraiment.
export function dateSaisieLisible(valeur: string | null): string {
  if (!valeur) return "aucune date de fin : accès sans échéance";
  const instant = instantDepuisParis(valeur);
  return instant ? `${dateHeureParis(instant)} (${MENTION_FUSEAU})` : valeur;
}

// La valeur exacte de l'action : la date de fin, ou le nombre de crédits.
// C'est la ligne que window.confirm ne montrait pas.
export function valeurDemande(demande: DemandeAdmin): { label: string; valeur: string } {
  if (demande.kind === "credits") {
    const signe = demande.delta > 0 ? "+" : "−";
    return { label: "Crédits", valeur: `${signe}${Math.abs(demande.delta)} crédit(s)` };
  }
  if (demande.action === "revoke") {
    return { label: "Effet", valeur: "l'accès offert est retiré immédiatement" };
  }
  // Mission #146 — la ligne porte elle-même « heure de Paris ». La réserve
  // d'avant (« envoyée telle quelle, sans fuseau ») n'a plus lieu d'être : le
  // fuseau n'est plus laissé au hasard du serveur, il est choisi.
  return { label: "Fin de l'accès", valeur: dateSaisieLisible(demande.expiresAt) };
}

// Le récapitulatif seul, sans l'enveloppe de la modale : un composant pur, que
// le test rend directement pour vérifier les quatre lignes.
export function RecapitulatifDemande({ demande, email }: { demande: DemandeAdmin; email: string | null }) {
  const valeur = valeurDemande(demande);
  return (
    <dl className="grid gap-3 text-small sm:grid-cols-[9rem_1fr]">
      <dt className="text-attenue">Compte</dt>
      <dd className="font-semibold break-all text-encre">{email ?? "Compte sans email"}</dd>
      <dt className="text-attenue">Action</dt>
      <dd className="font-semibold text-encre">{titreDemande(demande)}</dd>
      <dt className="text-attenue">{valeur.label}</dt>
      <dd className="font-semibold text-encre">{valeur.valeur}</dd>
      <dt className="text-attenue">Motif</dt>
      <dd className="break-words text-encre">{demande.reason}</dd>
    </dl>
  );
}

// La modale elle-même : le test la rend directement et vérifie le balisage
// réel — le rôle, le titre, les quatre lignes, les deux boutons — plutôt que
// de chercher des chaînes dans ce fichier.
//
// ELLE PORTE SON PROPRE CLAVIER, et c'est le point. La première version
// laissait l'écouteur Échap dans UserActions, au-dessus : la boîte rendue
// ailleurs — l'aperçu de développement, par exemple — ne se fermait plus au
// clavier, et rien ne le disait. Une modale qui ne gère pas sa propre
// fermeture n'est pas réutilisable sans la casser.
export function ConfirmationAdmin({
  demande,
  email,
  onAnnuler,
  onConfirmer,
}: {
  demande: DemandeAdmin;
  email: string | null;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  const annulerRef = useRef<HTMLButtonElement>(null);

  // Échap ferme. L'écouteur est posé sur le document et non sur la boîte :
  // il doit répondre même si le focus n'est pas (ou plus) dedans.
  useEffect(() => {
    const auClavier = (event: KeyboardEvent) => {
      if (event.key === "Escape") onAnnuler();
    };
    document.addEventListener("keydown", auClavier);
    return () => document.removeEventListener("keydown", auClavier);
  }, [onAnnuler]);

  // Le focus va sur « Annuler », pas sur la validation : une touche Entrée
  // réflexe doit renoncer, jamais accorder un accès ou retirer des crédits.
  useEffect(() => {
    annulerRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-encre/60 p-4 sm:items-center"
      // Un clic en dehors renonce, comme Échap et comme « Annuler ».
      onClick={onAnnuler}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-confirmation-admin"
        // Pas d'ombre : le système de dessin l'interdit (tests/design.test.ts).
        // Le détachement vient du voile sombre et du filet, comme ailleurs.
        //
        // La hauteur est BORNÉE et le contenu défile. Mesuré sur un écran de
        // 320 × 568 avec une adresse et un motif longs : sans cette borne, la
        // boîte montait à −156 px, le titre et la ligne « Compte » passaient
        // au-dessus du bord, et la page derrière ne défile pas (voile fixe).
        // On confirmait donc sans pouvoir lire le compte — exactement ce que
        // cette modale existe pour empêcher.
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-control border-2 border-encre bg-creme p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="titre-confirmation-admin" className="text-h2">Confirmer : {titreDemande(demande)}</h2>
        <p className="mt-2 text-small text-attenue">
          Vérifie le compte avant de valider. L’action est enregistrée dans l’audit admin.
        </p>
        <div className="mt-5 border-y border-filet py-5">
          <RecapitulatifDemande demande={demande} email={email} />
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button ref={annulerRef} type="button" onClick={onAnnuler} className="rounded-control border border-encre px-4 py-2 font-semibold text-encre">Annuler</button>
          <button type="button" onClick={onConfirmer} className="rounded-control bg-encre px-4 py-2 font-semibold text-creme">Confirmer</button>
        </div>
      </div>
    </div>
  );
}

export function UserActions({ userId, email, hasGrant }: { userId: string; email: string | null; hasGrant: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [demande, setDemande] = useState<DemandeAdmin | null>(null);

  // Stable : la modale s'en sert comme dépendance de son écouteur clavier.
  const fermer = useCallback(() => setDemande(null), []);

  async function envoyer(demande: DemandeAdmin) {
    setDemande(null);
    setPending(true);
    setMessage(null);
    const corps =
      demande.kind === "credits"
        ? { delta: demande.delta, reason: demande.reason }
        : { action: demande.action, reason: demande.reason, expiresAt: demande.expiresAt };
    try {
      const response = await fetch(`/api/admin/users/${userId}/${demande.kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // L'identifiant est tiré À L'ENVOI, comme avant : une demande annulée
        // puis relancée n'est pas la même, et l'idempotence côté base reste
        // celle d'un envoi.
        body: JSON.stringify({ ...corps, requestId: crypto.randomUUID() }),
      });
      setMessage(response.ok ? "Action enregistrée et auditée." : "Échec de l’action.");
      if (response.ok) router.refresh();
    } catch {
      setMessage("Service indisponible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border-t-4 border-marque pt-4">
      <h2 className="text-h2 mb-4">Actions sécurisées</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const reason = String(f.get("reason") ?? "");
            setDemande(
              hasGrant
                ? { kind: "entitlement", action: "revoke", reason, expiresAt: null }
                : { kind: "entitlement", action: "grant", reason, expiresAt: String(f.get("expiresAt") ?? "") || null },
            );
          }}
          className="flex flex-col gap-3"
        >
          <h3>{hasGrant ? "Retirer l’accès offert" : "Accorder Pro offert"}</h3>
          {hasGrant ? null : <input name="expiresAt" type="datetime-local" className="rounded-control border bg-creme px-3 py-2" />}
          <input name="reason" required minLength={2} maxLength={500} placeholder="Motif obligatoire" className="rounded-control border bg-creme px-3 py-2" />
          <button disabled={pending} className="rounded-control bg-encre px-4 py-2 font-semibold text-creme disabled:opacity-50">
            {pending ? "Enregistrement…" : hasGrant ? "Retirer le grant" : "Accorder le grant"}
          </button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setDemande({ kind: "credits", delta: Number(f.get("delta")), reason: String(f.get("reason") ?? "") });
          }}
          className="flex flex-col gap-3"
        >
          <h3>Ajuster les crédits</h3>
          <input name="delta" type="number" required min="-100000" max="100000" placeholder="+10 ou -2" className="rounded-control border bg-creme px-3 py-2" />
          <input name="reason" required minLength={2} maxLength={500} placeholder="Motif obligatoire" className="rounded-control border bg-creme px-3 py-2" />
          <button disabled={pending} className="rounded-control bg-encre px-4 py-2 font-semibold text-creme disabled:opacity-50">
            {pending ? "Enregistrement…" : "Ajuster et auditer"}
          </button>
        </form>
      </div>
      {message ? (
        <p role="status" className="mt-4 font-semibold">
          {message}
        </p>
      ) : null}
      {demande ? (
        <ConfirmationAdmin
          demande={demande}
          email={email}
          onAnnuler={fermer}
          onConfirmer={() => void envoyer(demande)}
        />
      ) : null}
    </section>
  );
}
