# Progresso

## Etapa 1 — Fundação ✅

**Feito**

- Monorepo pnpm + Turborepo, TypeScript base, ESLint/Prettier únicos, catálogo de versões.
- `packages/shared` com marca, `formatBRL` e testes.
- `apps/api` (NestJS + Prisma/PostGIS) com `GET /health`.
- `apps/mobile` (Expo) com tela inicial da marca.
- `apps/admin` reservado.
- Docker Compose (Postgres/PostGIS + Redis), `.env.example`.
- Regra de importação entre apps (ESLint + `scripts/check-imports.mjs`).
- Workflows de CI e deploy (esqueleto) por app.
- Docs: PROJETO, ARQUITETURA, DECISOES, PROGRESSO.

**Como rodar**

```
pnpm install
cp .env.example .env
pnpm db:up
pnpm build
pnpm test && pnpm typecheck && pnpm lint
node apps/api/dist/main.js        # curl localhost:3000/health
pnpm --filter @amma/mobile dev    # Expo
```

**Falta / próximos passos**

- Etapa 2: regras de negócio em `shared` (taxas, cotas, níveis, piso km/min, estados da corrida) com testes.
- Modelos Prisma e migrações; autenticação.
- Fonte Outfit no mobile; admin; destino real de deploy; repositório git ainda não inicializado.
