# Arquitetura

## Estrutura

```
amma-app/
├── apps/
│   ├── api/       NestJS + Prisma (PostgreSQL/PostGIS) + Redis: auth, account, driver, admin, legal,
│   │              delivery (pedidos), dispatch, presence, realtime (WebSocket), ledger, pricing, routing
│   ├── mobile/    Expo + React Native (app do motorista em src/driver; ver docs/MOBILE.md)
│   └── admin/     Next.js (reservado, etapa futura)
├── packages/
│   └── shared/    @amma/shared: marca, preço, taxas, cotas, ledger, validadores, estados da corrida e da entrega, despacho, geo
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

## API: módulos da Etapa 4 (`apps/api/src`)

| Pasta       | Responsabilidade                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `delivery/` | Pedido: cotação, criação, cancelamento, andamento pelo motorista; controllers de cliente/motorista/admin |
| `dispatch/` | Escolha do motorista, ofertas (aceitar/recusar/expirar), rotina periódica, parâmetros, regras públicas   |
| `presence/` | Online/offline e posição: Redis (`PositionStore`) + PostGIS                                              |
| `realtime/` | Gateway WebSocket `/ws` e registro de conexões                                                           |
| `ledger/`   | Persistência do ledger (somente inserção) e carteira                                                     |
| `pricing/`  | Tabelas de preço versionadas                                                                             |
| `routing/`  | `RouteProvider` (simulado e Mapbox); devolve o trajeto (`path`) quando pedido                            |
| `push/`     | `PushService` + `PushSender` (simulado e Expo): aviso de nova oferta com o app fechado (Etapa 5)         |

As regras puras (estados, cancelamento, ranking do despacho, geo) ficam em `packages/shared` e são testadas lá; a API só busca dados e aplica.

## App do motorista (`apps/mobile/src/driver`, Etapa 5)

| Arquivo/pasta                                              | Responsabilidade                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DriverProvider.tsx`                                       | Estado único do motorista (presença, posição, oferta, entrega, ganhos) e as ações; liga WebSocket, GPS e push                      |
| `DriverApp.tsx`                                            | Abas Início / Entrega (só com pedido) / Ganhos / Conta; consentimento tem prioridade sobre tudo                                    |
| `screens/`                                                 | Telas: `DriverHome`, `ActiveDeliveryScreen`, `EarningsScreen`, `AccountScreen`, `LocationConsentScreen`                            |
| `components/`                                              | `OfferCard`, `StepProgress`, `ComparisonCard`, `WeekChart`, `Simulator`, `RouteMap`, `states` (carregando/erro/sem internet), etc. |
| `realtime.ts`                                              | Cliente WebSocket com reconexão (sem React; testável)                                                                              |
| `location.ts` / `backgroundLocation.ts` / `positionBus.ts` | Permissões, leitura de posição (primeiro e segundo plano) e a tarefa do sistema, registrada em `index.ts`                          |
| `push.ts`                                                  | Permissão, token do Expo e registro na API                                                                                         |
| `useRouteInfo.ts`                                          | Busca a rota na API (só quando a etapa muda ou o motorista sai da rota)                                                            |

O motorista continua sem biblioteca de navegação: o estado decide a tela (ver `docs/DECISOES.md`). Regras de ganhos (comparativo de 25%, semana, simulador, detalhamento da oferta) vivem em `packages/shared/src/earnings.ts`.

## Testes

- `pnpm test` — unitários, sem banco (shared e api).
- `pnpm --filter @amma/mobile test` — Jest (jest-expo + Testing Library): componentes, hooks, provider e cliente WebSocket, com os módulos nativos trocados por mocks (`apps/mobile/jest.setup.ts`). **Não** substitui o teste em celular real (`docs/MOBILE.md`).
- `pnpm --filter @amma/api test:int` — integração com Postgres/PostGIS e Redis reais (`docker compose up -d`). Usa o banco `amma_test` e o Redis db 15, criados/migrados automaticamente. No CI, `ci-api.yml` sobe os dois serviços.
