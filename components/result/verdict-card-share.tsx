"use client";

import { ImageIcon, Share2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { currentAttribution } from "@/components/analytics/first-party-view";
import { Button } from "@/components/ui/button";
import { VERDICT_CARD_FILENAME, VERDICT_CARD_SIZE } from "@/lib/share-card/verdict-card";

// Mission #165 — LA CARTE QU'ON ENVOIE À SES COPINES.
//
// Deux temps, et c'est tout le point :
//   1. « Voir ma carte » : UNE génération, au clic. Jamais au chargement de
//      la page — chaque vue paierait sinon un rendu d'image pour des gens qui
//      ne partageront pas (règle posée en #064, elle tient toujours).
//   2. la carte s'affiche, et le MÊME fichier est celui qui partira. Elle voit
//      exactement ce qui sort : pas de partage à l'aveugle.
//
// POURQUOI LE FICHIER EST PRÊT AVANT LE CLIC DE PARTAGE. `navigator.share()`
// exige un geste utilisateur, et iOS considère le geste perdu dès qu'un
// `await` s'intercale entre le clic et l'appel. Le blob est donc récupéré à
// l'étape 1, converti en File tout de suite, et le gestionnaire de partage
// appelle `share()` SANS rien attendre.
//
// JAMAIS DE PARTAGE AUTOMATIQUE : rien ne part sans un second clic.

type Etat =
  | { kind: "repos" }
  | { kind: "chargement" }
  | { kind: "prete"; url: string; fichier: File }
  | { kind: "indisponible" }
  | { kind: "erreur" };

const ERREUR = "La carte n'a pas pu être créée. Réessaie dans un instant ; si ça recommence, recharge la page.";
const INDISPONIBLE = "La carte n'est pas disponible pour cette analyse.";

// Deux drapeaux, et rien d'autre : une carte est partie. Aucun montant, aucun
// contenu, aucun identifiant. Une mesure qui échoue n'empêche jamais l'envoi.
function signaler(event: "carte_partagee" | "carte_telechargee"): void {
  try {
    if (navigator.doNotTrack === "1") return;
  } catch {
    return;
  }
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ event, attribution: currentAttribution() }),
  }).catch(() => undefined);
}

export function VerdictCardShare({ href = "/api/carte" }: { href?: string }) {
  const [etat, setEtat] = useState<Etat>({ kind: "repos" });
  // Le partage natif n'est connu qu'à l'exécution. Déterminé une fois la
  // carte prête, parce qu'il dépend du fichier lui-même (canShare({files})).
  const [partageable, setPartageable] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function preparer() {
    if (etat.kind === "chargement") return;
    setEtat({ kind: "chargement" });
    try {
      const reponse = await fetch(href, { cache: "no-store" });
      // 404 : pas de carte pour ce navigateur. Ce n'est pas une panne, et on
      // ne propose pas de réessayer.
      if (reponse.status === 404) {
        setEtat({ kind: "indisponible" });
        return;
      }
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      const blob = await reponse.blob();
      if (!blob.type.startsWith("image/")) throw new Error("réponse non image");
      const fichier = new File([blob], VERDICT_CARD_FILENAME, { type: "image/png" });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPartageable(peutPartager(fichier));
      setEtat({ kind: "prete", url, fichier });
    } catch {
      setEtat({ kind: "erreur" });
    }
  }

  // Appelé DANS le gestionnaire de clic, sans await devant : c'est la seule
  // façon qu'iOS reconnaisse encore le geste.
  function partager(fichier: File) {
    try {
      void navigator
        .share({ files: [fichier] })
        .then(() => signaler("carte_partagee"))
        // AbortError : elle a fermé la feuille de partage. C'est un abandon
        // normal, pas une erreur — aucun message, aucun drapeau.
        .catch((erreur: unknown) => {
          if (!(erreur instanceof Error) || erreur.name !== "AbortError") setEtat({ kind: "erreur" });
        });
    } catch {
      setEtat({ kind: "erreur" });
    }
  }

  return (
    <section aria-label="Carte de verdict à partager" className="flex flex-col gap-3">
      {etat.kind === "prete" ? (
        // eslint-disable-next-line @next/next/no-img-element -- image locale (blob) : next/image ne s'applique pas
        <img
          src={etat.url}
          alt="Ta carte : le montant proposé, ce que ça vaut, le verdict et les contenus demandés, sans le nom de la marque ni le tien."
          width={VERDICT_CARD_SIZE.width}
          height={VERDICT_CARD_SIZE.height}
          className="aspect-[4/5] h-auto w-full max-w-72 rounded-control border-2 border-encre sm:max-w-80"
        />
      ) : null}

      {etat.kind === "prete" ? (
        partageable ? (
          <Button type="button" variant="outline" size="lg" onClick={() => partager(etat.fichier)} className="w-full sm:w-fit">
            <Share2Icon />
            Partager
          </Button>
        ) : (
          <Button asChild variant="outline" size="lg" className="w-full sm:w-fit">
            <a href={etat.url} download={VERDICT_CARD_FILENAME} onClick={() => signaler("carte_telechargee")}>
              <Share2Icon />
              Télécharger
            </a>
          </Button>
        )
      ) : (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={preparer}
          aria-busy={etat.kind === "chargement"}
          aria-disabled={etat.kind === "chargement" || etat.kind === "indisponible"}
          disabled={etat.kind === "indisponible"}
          className="w-full sm:w-fit"
        >
          <ImageIcon />
          {etat.kind === "chargement" ? "Création de ta carte…" : etat.kind === "erreur" ? "Réessayer" : "Voir ma carte"}
        </Button>
      )}

      {etat.kind === "erreur" || etat.kind === "indisponible" ? (
        <p role="alert" className="alert-bad text-small">
          {etat.kind === "indisponible" ? INDISPONIBLE : ERREUR}
        </p>
      ) : null}

      <p className="text-small text-attenue">
        Le montant proposé, ce que ça vaut et le verdict, sans le nom de la marque ni le tien.
      </p>
    </section>
  );
}

// `canShare({files})` est la seule réponse fiable : un navigateur peut
// connaître navigator.share sans accepter de fichiers.
function peutPartager(fichier: File): boolean {
  try {
    return "canShare" in navigator && navigator.canShare({ files: [fichier] });
  } catch {
    return false;
  }
}
