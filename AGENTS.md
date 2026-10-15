<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Comment on travaille sur ce dépôt

Ces règles viennent de défauts réellement rencontrés. Chacune porte ce qui l'a
établie : un fichier, un test, un commit. Si une règle te paraît inutile, va
voir sa référence avant de l'écarter.

### La mission

- **Toute mission se termine par le commit ET le push.** Le rapport donne le
  hash poussé, et le résultat des tests, du build, du typecheck ET du lint.
  Les quatre, nommés, pas « tout est vert ».
- **« En attente de toi » ne contient QUE ce que la mission en cours laisse en
  suspens.** Rien d'autre : pas un point fermé par une mission précédente, pas
  un sujet général. Un point tranché par l'éditeur ne se repropose jamais — il
  part dans `DECISIONS.md`, et c'est là qu'on va vérifier avant de le
  remettre sur la table.
- **Une dette qu'on parque va dans SON PROPRE commit**, dont le message la
  nomme. Elle ne se glisse pas dans un commit qui fait autre chose.
- **`CURRENT.md` se met à jour à chaque mission.** Un fichier de mémoire
  périmé coûte plus cher que pas de fichier : celui-ci annonçait la mission
  #008 alors que le dépôt en était à la #19x.

### Ce qu'on n'écrit jamais

- **Aucune supposition dans un fichier de mémoire.** Ce qui ne se vérifie pas
  dans le dépôt — code, tests, migrations, `.env.example`, journal git —
  s'écrit UNKNOWN en toutes lettres, ou se range sous « à confirmer par
  l'éditeur ». Pas de formule prudente qui ressemble à un fait.
- **Ne déclare pas un état de production que tu n'as pas mesuré.** Une clé
  renseignée chez l'hébergeur, une adhésion souscrite, un achat réellement
  passé : rien de tout cela ne se lit dans le dépôt.

### La base

- **Les migrations Supabase : tu les écris, tu donnes le SQL exact, tu ne les
  appliques JAMAIS.** L'éditeur les colle lui-même. Même règle pour un
  rattrapage de données : le SELECT qui montre les lignes concernées d'abord,
  l'UPDATE ensuite, et si aucun critère n'est fiable, tu le dis et tu ne
  proposes pas d'UPDATE approximatif.
- **Tout appel sortant porte un plafond**, lu dans `lib/reseau/delais.ts`. Un
  dépassement est une panne du fournisseur, jamais un refus — voir la décision
  11 de `DECISIONS.md`, qui explique ce que cette confusion déconnecterait.

### Vérifier, pas supposer

- **Une correction ne se valide pas sur `/analyse/demo`.** Cette page rend
  `sampleAnalysis`, qui est `composeAnalysis(...)` appliqué à une fixture
  (`lib/sample-analysis.ts`) : tout y est recalculé à chaque rendu. Elle ne
  peut donc porter aucun défaut de données ENREGISTRÉES, qui est précisément la
  classe de défaut qu'on cherche la plupart du temps.
- **Une largeur se MESURE en pixels, elle ne se COMPTE pas en caractères.**
  Mesuré pendant la #195 : « négociations illimitées » fait 23 caractères et
  121,88 px, « négociations restantes » en fait 22 et 124,27 px. Un gabarit
  choisi au nombre de caractères laissait donc 2,4 px de saut.
- **Une batterie de mutation tourne sur les fichiers de test touchés par chaque
  garde, plus UNE passe complète à la fin.** Elle sert à répondre à « cette
  garde est-elle vivante », et elle trouve à peu près toujours quelque chose :
  une garde morte, ou une mutation invalide qui apprend autant.

### Les expressions régulières, en français

- **Une expression régulière écrite en français se vérifie sur un mot
  accentué.** `connecté\b` ne correspond jamais : `é` n'est pas dans
  `\w`, donc il n'y a pas de limite de mot entre lui et un non-mot. Le
  terminateur sûr est `(?![a-zà-ÿ])`. Relevé en #158, retrouvé en #177 sur
  « noté », et encore en #183.
- **Un `\b` écrit dans un heredoc devient un caractère de contrôle 0x08** et
  rend une garde silencieusement morte : le motif ne peut plus correspondre, et
  le caractère ne s'affiche pas à la relecture. Trois cas trouvés pendant la
  #195, dont deux anciens où une alternative entière était inerte.
  `tests/caracteres-controle.test.ts` surveille le dépôt depuis `9e752c6`,
  mais la règle reste à connaître AVANT d'écrire : écris les motifs avec l'outil
  d'écriture de fichier, pas dans un heredoc.

