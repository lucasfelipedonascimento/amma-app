# Arquitetura

## Estrutura

```
amma-app/
├── apps/
│   ├── api/       NestJS + Prisma (PostgreSQL/PostGIS): auth, account, driver, admin, legal
│   ├── mobile/    Expo + React Native
│   └── admin/     Next.js (reservado, etapa futura)
├── packages/
│   └── shared/    @amma/shared: marca, preço, taxas, cotas, ledger, validadores, estados da corrida
├── scripts/       check-imports.mjs (regra de importação)
├── .github/workflows/  ci-*.yml e deploy-*.yml, um par por app
├── docker-compose.yml  Postgres+PostGIS e Redis locais
├── pnpm-workspace.yaml workspaces + catálogo de versões comuns
└── turbo.json          tarefas e cache do Turborepo
```

## Regras de importação

- `apps/*` podem importar de `packages/shared`; **nunca** de outro app.
- Aplicadas por: ESLint (`no-restricted-imports`) e `pnpm check:imports` (bloqueia dependência entre apps no package.json).

## Dependências comuns

- Versões compartilhadas (typescript, vitest, eslint, prettier, @types/node) ficam no **catálogo** de `pnpm-workspace.yaml`; os pacotes usam `"catalog:"`.
- ESLint, Prettier e `tsconfig.base.json` são únicos na raiz.

## Turborepo

`pnpm build|test|lint|typecheck` rodam só o que mudou (cache em `.turbo`). `shared` é compilado antes dos apps (`dependsOn: ^build`).

## CI / Deploy

Um workflow de CI e um de deploy por app, filtrados por `paths` (a pasta do app + `packages/shared` + config raiz). Deploy é esqueleto até definirmos o destino.

## Layout de node_modules

`.npmrc` usa `node-linker=hoisted` porque o Metro (Expo) não lida bem com o layout em symlinks do pnpm.
