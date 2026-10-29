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

## Etapa 2 — Regras de negócio em `packages/shared` ✅

**Feito** (funções puras, 25 testes):

- `fees.ts`: taxa base 10% + associação 0/2/4%, líquido do trabalhador.
- `quotas.ts`: 1 cota = R$ 5, acúmulo de resto, níveis Bronze/Prata/Ouro.
- `pricing.ts`: piso por km/min (`minimumFare`) e `applyFloor`.
- `ride-state.ts`: máquina de estados da corrida/entrega.

**Como testar**

```
pnpm --filter @amma/shared test
pnpm test && pnpm lint && pnpm typecheck
```

**Falta / a confirmar**

- Valores reais do piso por km e por minuto.
- Se a taxa de associação incide sobre o bruto (atual) ou o líquido.
- Regras de cancelamento (multa/tolerância).
- Próxima etapa: modelos Prisma (usuários, perfis, corridas, cotas), migrações e autenticação.
