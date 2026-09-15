# Negoscore

Colle l'offre d'une marque : on te dit ce qu'elle vaut, ce que tu cèdes, et quoi répondre.

## Commandes
```bash
pnpm install
pnpm dev        # http://localhost:3000 (clés lues depuis .env.local)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm eval       # éval des modèles sur evals/fixtures, résultats dans evals/results
pnpm eval:vision        # éval image sur evals/fixtures-vision
pnpm test:integration   # RLS, bucket et usage_guard contre Supabase (migrations appliquées)
```

## Stack
Next.js (App Router) · TypeScript strict · Tailwind CSS · shadcn/ui · Zod · Vitest · SDK OpenAI, Anthropic, Google (éval).
Le modèle extrait, le code chiffre (`lib/rates`) et gère la couche légale (`lib/legal`). Voir PRODUCT.md, CURRENT.md, DECISIONS.md.
