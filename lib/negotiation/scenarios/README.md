# Scénarios de réponses de marque (mission #080, F8)

Un fichier JSON par scénario. Les tests (`tests/negotiation-scenarios.test.tsx`)
les prennent tous automatiquement et font tourner le **code** sur la sortie du
modèle enregistrée dans chaque fichier : vérification des citations, mise à jour
des termes, chiffrage par le moteur, contrôle du message, conclusion. Ils
n'appellent jamais le modèle.

Les scénarios actuels sont **inventés** (`"source": "inventé"`), y compris la
sortie du modèle, écrite à la main.

## Remplacer un scénario inventé par un vrai échange

1. Copie le fichier le plus proche (par exemple `05-refus-net.json`) sous un
   nouveau nom, ou modifie-le directement.
2. Mets `"source": "réel"` et colle la vraie réponse de la marque dans
   `reponse_marque`. Retire tout ce qui identifie une personne (prénom, email,
   numéro) : le dépôt n'est pas un endroit pour des données personnelles.
3. Si l'offre de départ n'est pas `sample-extraction`, ajoute son extraction
   dans `lib/fixtures/` et indique son nom dans `offre`.
4. Écris dans `attendu` ce que tu attends (issue, termes changés, statut des
   demandes, conclusion, message de repli ou non).
5. Enregistre la sortie du vrai modèle pour ce scénario (appel payant) :

   ```
   pnpm negociation:enregistrer 05-refus-net
   ```

   Le script réécrit seulement `sortie_modele` et affiche les écarts entre ce
   que donne le modèle et ce que tu attends.
6. `pnpm test` : s'il échoue, c'est soit le prompt
   (`lib/llm/turn-prompt.ts`) qui est à revoir, soit l'attendu qui était faux.

## Champs

- `reponse_marque` : le texte collé par la créatrice.
- `sortie_modele` : la lecture du modèle (schéma `turnReadingSchema`,
  `lib/negotiation/types.ts`). Dans un scénario inventé, `deal` peut n'être
  qu'un correctif de l'offre de départ ; une sortie enregistrée le contient en
  entier.
- `attendu.type` : `tour` ou `hors_sujet`.
- `attendu.nouveau_chiffrage` : `true` si un terme change (ancien et nouveau
  chiffrage côte à côte), `false` si la fourchette doit rester celle de
  l'analyse d'origine.
- `attendu.message_de_repli` : `true` si le brouillon du modèle doit être
  écarté par les contrôles (montant, échéance, ton, citation inventée).
