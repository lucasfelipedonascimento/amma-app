# Arquitetura

## Estrutura

```
amma-app/
├── apps/
│   ├── api/       NestJS + Prisma (PostgreSQL/PostGIS) + Redis: auth, account, driver, admin, legal,
│   │              delivery (pedidos), dispatch, presence, realtime (WebSocket), ledger, pricing, routing
│   ├── mobile/    Expo + React Native (app do motorista em src/driver; ver docs/MOBILE.md)
│   └── admin/     Next.js 15: painel web da associação (Etapa 10; ver abaixo)
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
| `payments/` | `PaymentProvider` (sandbox), cobrança, Pix pendente/vencido, estorno, rotina de repetição (Etapa 6)      |
| `merchant/` | Cadastro do estabelecimento e relatório do comerciante (Etapa 6)                                         |

As regras puras (estados, cancelamento, ranking do despacho, geo, estados do pagamento e política de estorno, recibo, relatório do comerciante) ficam em `packages/shared` e são testadas lá; a API só busca dados e aplica.

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

## App do cliente e do comerciante (`apps/mobile/src/client`, Etapa 6)

| Arquivo/pasta                  | Responsabilidade                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientProvider.tsx`           | Pedidos, estabelecimento, `GET /payments/config` e um WebSocket único que reparte os eventos; consulta a cada 5 s sem ele                                                        |
| `ClientApp.tsx`                | Abas Pedir / Pedidos / (Loja / Relatório, só comerciante) / Conta; acompanhamento e recibo abrem por cima das abas                                                               |
| `screens/`                     | `NewDeliveryScreen` (origem, destino, descrição → preço → pagamento), `TrackingScreen`, `OrdersScreen`, `ReceiptScreen`, `MerchantScreen`, `ReportScreen`, `ClientAccountScreen` |
| `components/`                  | `DeliveryMap`, `ClientSteps`, `PixPanel`, `CardForm`, `RatingStars`, `DeliveryItem`, `DayBars`                                                                                   |
| `hooks.ts`                     | `useLiveDelivery` (pedido ao vivo), `useRemote`, `useNow`                                                                                                                        |
| `address.ts`                   | Endereço ⇄ coordenadas com o geocodificador do aparelho (`expo-location`), sem chave nossa                                                                                       |
| `labels.ts` / `receiptText.ts` | Textos em português dos estados, motivos e pagamento; texto do recibo para compartilhar                                                                                          |

Reaproveita `Page/Card/Row`, `TabBar` e os estados de carregamento/erro/sem internet de `src/driver/components` (mesma identidade visual). Quem tem o papel MOTORISTA continua indo para o app do motorista.

## Corridas de passageiro e segurança (Etapa 7)

Não há módulo paralelo: a corrida **é** um `Delivery` com `kind = CORRIDA` (ver `docs/DECISOES.md`). O que é novo:

| Onde                                                                | Responsabilidade                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/ride.ts`, `safety.ts`, `municipal-rules.ts`                 | Regras puras: tipos/perfis de preço, textos por tipo de pedido, PIN, regras do link, categorias de denúncia, retenção, **regras municipais e elegibilidade** |
| `api/src/rides`                                                     | `RidesService` (estimativa por tipo, pedido) e `RidesController` (`/rides`, links, foto, registro). Delega o pedido a `DeliveryService.create(…, ride)`      |
| `api/src/municipal`                                                 | `MunicipalRulesService`: regras vigentes (versionadas), publicação validada e avaliação de elegibilidade por motorista/veículo                               |
| `api/src/safety`                                                    | `SafetyService` (emergência, denúncia, link, registro, retenção, verificação de gênero), `RatingsService`, controllers (`/safety`, `/share`, `/admin/*`)     |
| `api/src/dispatch`                                                  | Ganhou os filtros de veículo/preferência e `availability()` (estimativa). O restante do despacho é o mesmo                                                   |
| `api/src/delivery`                                                  | `advance` confere o PIN; `relayToClient` grava o trajeto das corridas; `views.ts` decide o que cada parte enxerga                                            |
| `mobile/src/client/screens/RideScreen.tsx`, `components/RideSafety` | Pedir corrida; cartão do motorista (placa, foto, PIN), compartilhar, emergência e denúncia no acompanhamento (`TrackingScreen` serve às duas)                |
| `mobile/src/safety`                                                 | `ReportCard` e `RateCard`, usados pelos dois apps. `EmergencyButton` (em `driver/components`) também é usado pelo passageiro                                 |
| `mobile/src/driver/components/RideEligibilityCard.tsx`              | Conta do motorista: habilitação por veículo, envio dos documentos que faltam, autodeclaração de gênero                                                       |

## Associação (Etapa 8)

| Onde                                                                                     | Responsabilidade                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/membership.ts`, `assembly.ts`, `group-purchase.ts`, `insurance.ts`, `surplus.ts` | Regras puras: sócio e progresso de nível, apuração e quórum, fila por pontos e validação das regras votadas, máquina de estados do seguro, cálculo das sobras                                               |
| `shared/ledger.ts`                                                                       | `buildGroupContribution` e `buildSurplusDistribution` (novas contas `PARTNER_GROUP`, `MEMBER_GROUP`, `ASSOCIATION_SURPLUS`)                                                                                 |
| `api/src/association`                                                                    | Módulo próprio: `MembersService` (cotas/sócios do ledger), `AssemblyService`, `GroupPurchaseService` + `PurchasePartner` (parceiro simulado), `InsuranceService`, `SurplusService`, agendador de fechamento |
| `mobile/src/association`                                                                 | Aba “AMMA” do app do motorista: resumo, assembleia, compra coletiva e seguro (cada seção usa `useLoad`)                                                                                                     |

## Pontos de acolhida (Etapa 9)

| Onde                      | Responsabilidade                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/welcome-point.ts` | Regras puras: tipos e status, horário (`validateHours`, `isOpenAt`), checklist da casa, raio e tempos do check-in, benefício e teto mensal, quando suspender (`suspensionReason`), posição aproximada e filtros do mapa        |
| `shared/ledger.ts`        | `buildHostBenefit` (novas contas `ASSOCIATION_HOST_BENEFITS` e `HOST_DISCOUNT`, tipo `HOST_BENEFIT`)                                                                                                                           |
| `api/src/welcome`         | Módulo próprio: `PointsService` (cadastro, fotos, mapa, visão por pessoa), `CheckInService` (check-in, saída com benefício, avaliação dos dois lados), `ModerationService` (denúncia, suspensão automática, decisões do admin) |
| `mobile/src/welcome`      | Aba “Acolhida” do app do motorista: mapa e filtros, detalhe com check-in e denúncia, cadastro (com checklist), meus pontos e visitas                                                                                           |

## Painel admin (Etapa 10)

| Onde                                            | Responsabilidade                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/panel-access.ts`                        | Papéis de painel (`ADMIN`, `SOCIO`), áreas e quem abre cada uma. Usado pela API (guard) e pelo painel (menu e páginas)                                                                                                                     |
| `shared/moderation.ts`, `budget.ts`, `audit.ts` | Regras puras: bloqueio com motivo, recurso (prazo, uma vez, segunda opinião), orçamento (validação e soma) e textos/regra da trilha de auditoria                                                                                           |
| `api/src/backoffice`                            | `BlocksService`, `AuditService` + `AuditInterceptor` (global, toda rota `/admin/*`), `BudgetService`, `DirectoryService` (motoristas, comerciantes, usuários), `MetricsService`, `PanelGuard`; controllers `/panel`, `/me/block`, `/admin` |
| `api/src/auth/auth.guard.ts`                    | Conta bloqueada recebe `403 ACCOUNT_BLOCKED` em tudo, exceto rotas `@AllowBlocked()` (`GET /me`, `DELETE /me`, `/me/block`)                                                                                                                |
| `admin/src/middleware.ts`                       | Renova o token de acesso com o de renovação; sem sessão manda para `/login`                                                                                                                                                                |
| `admin/src/app/api`                             | `auth/*` (OTP → cookies httpOnly, só para quem tem papel de painel) e `proxy/[...path]` (repassa `/admin` e `/panel`, exige mesma origem nas escritas)                                                                                     |
| `admin/src/app/(panel)`                         | Páginas de servidor por área; `components/ActionForm.tsx` é o único componente de ação (aprovar, recusar com motivo, bloquear, cadastrar)                                                                                                  |

O navegador nunca fala com a API nem enxerga o token: o painel é o intermediário (CORS da API fechado por padrão; `CORS_ORIGINS` libera origens específicas). Dev: painel em `:3001`, API em `:3000` (`ADMIN_API_URL`).

## Testes

- `pnpm test` — unitários, sem banco (shared e api).
- `pnpm --filter @amma/mobile test` — Jest (jest-expo + Testing Library): componentes, hooks, provider e cliente WebSocket (motorista e cliente), com os módulos nativos trocados por mocks (`apps/mobile/jest.setup.ts`). **Não** substitui o teste em celular real (`docs/MOBILE.md`).
- `pnpm --filter @amma/admin test` — Vitest (jsdom): lógica de formulário/sessão, middleware, proxy, login, `ActionForm`, menu por papel e acesso por área.
- `pnpm --filter @amma/api test:int` — integração com Postgres/PostGIS e Redis reais (`docker compose up -d`). Usa o banco `amma_test` e o Redis db 15, criados/migrados automaticamente. No CI, `ci-api.yml` sobe os dois serviços.
