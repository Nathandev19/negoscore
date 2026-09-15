# Creator Deal Copilot (nom de travail, non verrouillé)

Colle l'offre d'une marque : on te dit ce qu'elle vaut, ce que tu cèdes, et quoi répondre.

## Commandes
```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Stack
Next.js (App Router) · TypeScript strict · Tailwind CSS · shadcn/ui · Zod · Vitest.
Le nom de marque vit uniquement dans `lib/brand.ts`. Voir PRODUCT.md, CURRENT.md, DECISIONS.md.
