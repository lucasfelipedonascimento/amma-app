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

## Etapa 3 — Banco e autenticação ✅

**Feito**

- Schema Prisma: `User` (com papéis), `Ride` (corrida/entrega com valores em centavos), `QuotaAccount`, `QuotaEntry`. Migração `init` (inclui PostGIS).
- Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (Bearer JWT). Validação de DTOs, ADMIN bloqueado no cadastro.
- Testes: 3 do `AuthService` + 1 de consistência de enum (Prisma x shared). Verificado manualmente contra o Postgres real.

**Como rodar**

```
pnpm db:up
cd apps/api && pnpm prisma:migrate     # aplica migrações (usa ../../.env)
cd ../.. && pnpm build
API_PORT=3000 node apps/api/dist/main.js
curl -X POST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"voce@exemplo.com","password":"senha12345","name":"Você","roles":["WORKER"]}'
```

`JWT_SECRET` é obrigatório no `.env` (gere com `openssl rand -hex 32`).

**Falta**

- Criar corrida/entrega (endpoints), fluxo de estados e fechamento financeiro (taxas + cotas) usando o `shared`.
- WebSocket, busca por proximidade (PostGIS), refresh token, recuperação de senha, rate limit no login.

## Etapa 2 (numeração do usuário) — Autenticação e cadastro ✅

**Feito**

- Login por telefone com OTP (simulado em dev) e JWT com refresh (rotação + detecção de reuso). Substitui e-mail/senha.
- Papéis PASSAGEIRO, MOTORISTA, COMERCIANTE, ADMIN; `AuthGuard` + `RolesGuard` (`@Roles`).
- Motorista: perfil (CPF validado, 18+), veículos (moto/carro, placa antiga ou Mercosul, modelo, ano), documentos (CNH, documento do veículo, foto) com status PENDENTE/APROVADO/REPROVADO; fila e revisão pelo ADMIN.
- LGPD: consentimento versionado, política (placeholder), exclusão de conta. Ver `docs/LGPD.md`.
- Migração `auth_phone_driver` e seed de exemplo (6 usuários).
- App: telefone/código, cadastro, escolha de papel, dados do motorista, envio de documentos, estado de aprovação, início (sair/excluir conta).
- Testes: 23 na API (OTP, refresh, guard de papéis, tipo de arquivo, storage, enums) + validações no `shared`. Teste manual de ponta a ponta na API (36 verificações, incluindo reuso de refresh, upload falso, 403 por papel, exclusão e limite de OTP).

## Etapa 3 (numeração do usuário) — Regras de dinheiro ✅

**Feito** (tudo em `packages/shared`, sem telas; 65 testes no total):

- `calculateFare`: base + km + minuto com piso; tabela versionada (`selectPricingConfig`).
- Divisão 10% + associação 0/2/4%, cotas com fração, líquido; R$ 11,00 a 2% = R$ 9,68 (testado).
- Ledger em partidas dobradas, append-only, com estorno; níveis Bronze/Prata/Ouro.
- Fórmulas em `docs/REGRAS_FINANCEIRAS.md`.

**Como rodar/testar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..
pnpm build && pnpm test && pnpm lint && pnpm typecheck
API_PORT=3000 node apps/api/dist/main.js
# login simulado: o código vem na resposta de /auth/otp/request (campo devCode)
curl -X POST localhost:3000/auth/otp/request -H 'content-type: application/json' -d '{"phone":"(83) 99999-0001"}'
pnpm --filter @amma/mobile dev      # app (EXPO_PUBLIC_API_URL=http://IP_DO_PC:3000 em celular físico; 10.0.2.2 no emulador Android)
```

Telefones do seed: admin +5583999990001, passageira ...0002, motorista aprovado ...0003, pendente ...0004, reprovado ...0005, comerciante ...0006.

**Falta / pendências**

- Telas não foram testadas em celular/emulador (só typecheck, lint e empacotamento Android com `expo export`).
- SMS real (provedor), armazenamento em bucket, texto jurídico da política, fonte Outfit no app.
- Persistir o ledger no PostgreSQL e ligar às corridas; valores reais do piso; regra de cancelamento.
- Painel web do admin (hoje a revisão de documentos é só por API).

## Etapa 4 — Pedidos de entrega na API ✅

**Feito** (documentação completa em `docs/API.md`)

- Máquina de estados `CRIADO → OFERECIDO → ACEITO → A_CAMINHO_COLETA → COLETADO → A_CAMINHO_ENTREGA → ENTREGUE`, com `CANCELADO` e motivos (`shared/delivery-state.ts`).
- Motorista online/offline (só aprovado); posição por WebSocket `/ws` guardada no Redis e no PostGIS (última posição, sem trajeto).
- Despacho: oferta ao mais próximo dentro do raio, um por vez, prazo para responder, janela máxima de busca; parâmetros editáveis pelo admin; regras públicas em `GET /dispatch/rules`; registro do motivo de cada decisão em `DeliveryEvent`. Recusar/expirar/ficar offline não pune.
- Rotas atrás de `RouteProvider` (simulado e Mapbox). Preço da entrega = rota + tabela versionada (`PricingConfigVersion`).
- Ao `ENTREGUE`: taxas congeladas e fechamento gravado no ledger persistido (somente inserção, garantido por gatilho no banco), na mesma transação. `GET /driver/wallet` mostra saldo e cotas.
- Testes: shared 86 (+21), api 28 unitários, **41 de integração** do fluxo completo (feliz, ledger, recusa/expiração/janela, concorrência, cancelamentos, autorização, WebSocket, Redis/PostGIS, exclusão de conta).

**Como rodar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..   # seed inclui tabela de preço de EXEMPLO
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm --filter @amma/api test:int     # precisa de Postgres e Redis (pnpm db:up); usa banco amma_test e Redis db 15
API_PORT=3000 node apps/api/dist/main.js
```

Variáveis novas: `ROUTE_PROVIDER` (`simulated`|`mapbox`), `MAPBOX_ACCESS_TOKEN`, `DISPATCH_TICK_MS` (ver `.env.example`).

**Falta / pendências**

- **Confirmar:** "raio e tempo configuráveis" foi lido como raio + prazo da oferta + tempo máximo de busca + idade máxima da posição. Se "tempo" era um limite de ETA até a coleta, é um campo a mais.
- Adaptador do Mapbox testado só com respostas simuladas (sem chave real). Google Routes não implementado.
- Valores reais da tabela de preço (o seed é de exemplo) e regra de cancelamento (multa/ressarcimento: hoje cancelar não gera lançamento, nem para o motorista que já coletou).
- Estorno persistido no ledger (a regra existe só em memória no `shared`).
- Prova de entrega (PIN/foto) e checagem de proximidade nos passos do motorista; idempotência na criação do pedido (duplo toque cria 2 pedidos).
- WebSocket em memória (1 instância); com mais instâncias, Redis pub/sub. Sem push notification quando o app está fechado.
- Telas do app para tudo isso (nenhuma tela foi criada nesta etapa) e painel admin.
- Remover `QuotaAccount`/`QuotaEntry` e `Ride.type = DELIVERY`, hoje sem uso.
- Retenção de endereços e do registro de decisões (LGPD).
