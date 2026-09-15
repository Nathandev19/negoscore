# PRODUCT

**Nom** : Creator Deal Copilot — nom de travail, BRAND_STATUS = NOT_LOCKED.

## Cible
Créateurs UGC francophones qui reçoivent des offres de marques (DM, mail, brief, contrat), sans agent ni juriste.

## Problème
Ils ne savent pas ce que vaut une offre, ce qu'ils cèdent (droits pub, exclusivité, rushs, révisions) ni comment négocier sans perdre le deal. Résultat : ils signent sous-payés et à l'aveugle.

## Promesse
« Cette marque te propose combien ? » — un score, un chiffrage en euros, les points à négocier et un message prêt à envoyer, en 30 secondes.

## Wedge
Coller le message tel quel (texte, capture, PDF) et obtenir une réponse chiffrée et actionnable en français. Pas un cours, pas un annuaire de tarifs : une réponse à *cette* offre.

## Scope MVP
- Landing FR mobile-first avec zone de dépôt au-dessus du pli.
- Input : texte collé, photo (JPG/PNG/WebP), PDF — 10 Mo max.
- Analyse : score /100, confiance, récap du deal, points forts, points à négocier chiffrés, red flags, alerte légale FR, estimation.
- Contre-offre chiffrée et message prêt à envoyer derrière un gate email.
- Suppression des documents après 30 jours.

## Hors scope MVP
Compte avec mot de passe, historique, app mobile, anglais, rédaction de contrats, conseil juridique, marketplace de marques, agence.

## Pricing
À décider. Hypothèse de départ : analyse gratuite, contre-offre et message débloqués par email, offre payante via Whop. Aucun prix affiché avant validation.

## Stack
Next.js App Router, TypeScript strict, Tailwind CSS, shadcn/ui, Zod, Vitest. Prévu : Supabase, Whop, Resend, PostHog, Vercel Pro. Modèle IA non choisi (benchmark mission #002).

## Métriques
- Activation : % de visiteurs landing qui lancent une analyse.
- Conversion gate : % d'analyses qui débloquent par email.
- Conversion payante : % d'emails qui achètent.
- Qualité : % d'analyses jugées justes sur nos fixtures de référence.
- Acquisition : vues → visites par screen recording vertical publié.
