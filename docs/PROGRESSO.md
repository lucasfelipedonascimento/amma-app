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

## Etapa 5 — App do motorista ✅ (sem teste em celular real)

**Feito** (detalhes em `docs/MOBILE.md` e `docs/API.md` seção 11)

- **Início:** online/offline, ganhos do dia com o comparativo de **25%** (“na AMMA / num app com 25% / a mais no seu bolso”), cartão de oferta com Aceitar/Recusar mostrando **corrida, taxa base (10%), taxa da associação e valor líquido**, contagem regressiva.
- **Entrega em andamento:** mapa com rota e sua posição ao vivo, 4 etapas, botão do próximo passo, “não consigo seguir” (até a coleta), abrir no app de mapas e **emergência** (confirma e liga 190/192/193).
- **Ganhos:** semana dia a dia, histórico, simulador (valor × 0/2/4%). Aba **Conta** com revogação do consentimento, sair e excluir conta.
- **Localização em segundo plano** (permissão “o tempo todo”, serviço em primeiro plano no Android) com **tela de consentimento** antes do pedido do sistema; consentimento versionado e gravado na API (LGPD). Sem a permissão “o tempo todo” o app avisa e funciona só com a tela aberta.
- **Push** de nova oferta (Expo): `PushService` na API, token por aparelho, sem endereço na mensagem, tokens mortos limpos.
- **Estados** de carregamento, erro (com “Tentar de novo”) e sem internet (faixa) em todas as telas; WebSocket com reconexão e consulta a cada 5 s enquanto ele estiver fora.
- **API nova:** `GET /driver/earnings`, `GET /driver/deliveries/:id/route`, `POST /driver/position`, consentimento de localização, `PUT/DELETE /driver/push-token`; rotas com `path` (trajeto) no `RouteProvider`.
- **shared:** `earnings.ts` (comparativo 25%, dia no fuso de João Pessoa, semana, simulador, detalhe da oferta) e `location-consent.ts`.
- **Testes:** shared 109 (+23), api 38 unitários (+10) e **54 de integração** (+13), **mobile 97** (Jest + Testing Library: componentes, hook de rota, provider, WebSocket). Bundle Android conferido com `expo export`; fluxo ponta a ponta feito com a API real.

**Como rodar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..     # migração nova: push_location_consent
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm --filter @amma/api test:int
pnpm --filter @amma/mobile test
```

Celular real: **`docs/MOBILE.md`** (build de desenvolvimento, chaves, roteiro de teste marcável). Pedido de teste: `node scripts/demo-delivery.mjs <lat> <lng> <url-da-api>`.

**Falta / pendências**

- **Nada foi testado em aparelho físico:** segundo plano com a tela apagada/app encerrado, entrega do push e o mapa real dependem de chaves suas (Google Maps, Firebase/FCM, `EAS_PROJECT_ID`) e de um build de desenvolvimento. Não há `eas.json`.
- **Emergência só liga para 190/192/193** (e para um número da central, se `EXPO_PUBLIC_AMMA_SUPPORT_PHONE` existir). Avisar a associação/cliente com a localização exige um canal que ainda não existe — definir com a associação.
- O servidor **não exige** o consentimento de localização para ficar online (só o app exige).
- Rota: o provedor simulado devolve uma reta; ruas de verdade só com `ROUTE_PROVIDER=mapbox` (não testado com chave real). Sem “rota recalculada” se o motorista desvia menos de 200 m ou antes de 15 s.
- Fabricantes que matam apps em segundo plano (economia de bateria) podem interromper a posição; precisa de teste em aparelhos reais e orientação ao motorista.
- Localização usa o tempo real do WebSocket; se ele estiver “meio morto” (sem sinal, mas não fechado) a posição só volta pelo REST depois que o app notar. Sem heartbeat ainda.
- Sem fonte Outfit, sem ícone/splash, sem acessibilidade revisada em leitor de tela, sem tema escuro.
- Telas de cliente/comerciante, painel admin, push para o cliente e multa/ressarcimento seguem pendentes (Etapa 4).
- Ganhos mostram o que está no ledger/pedido; o saque/repasse ao parceiro regulado ainda não existe.

## Etapa 6 — Pedir entrega (cliente e comerciante) ✅ (sem teste em celular real)

**Feito** (detalhes em `docs/API.md` seção 12, `docs/REGRAS_FINANCEIRAS.md` seção 6 e `docs/MOBILE.md` roteiro F)

- **Cliente:** informa coleta, entrega e descrição → vê o **preço antes de confirmar** (com mapa) → escolhe Pix ou cartão → acompanha em tempo real (etapas, motorista no mapa, pagamento) → pode cancelar até a coleta → **avalia** (1–5) → vê o **recibo** e o **histórico**.
- **Comerciante:** cadastra o estabelecimento (nome, CNPJ opcional validado, endereço; vira a coleta padrão), cria entregas pelo mesmo fluxo, histórico e **relatório simples** (7/30/90 dias: gasto, pedidos, cancelados, médio, estornado, gasto por dia).
- **Pagamento por interface** (`PaymentProvider`) com **provedor simulado**: cartão (aprovado/recusado/saldo/indisponível por cartões de teste) e Pix (código de mentira, “pago” só por uma rota de teste, 15 min de prazo). Estados `PENDENTE → PAGO → ESTORNADO` ou `EXPIRADO`.
- **Estorno:** automático e total em qualquer cancelamento (inclusive “sem motorista”); a rotina repete se o provedor falhar; estorno é idempotente. Pix não pago cancela o pedido.
- **Despacho** só começa com o pagamento confirmado; a janela de busca conta do pagamento.
- **Segurança do dinheiro:** número de cartão nunca chega à API/banco (token); `idempotencyKey` (duplo toque não cobra duas vezes); `expectedFareCents` (cliente paga o que viu); cobrança sem pedido gravado é estornada na hora.
- **shared:** `payment.ts`, `receipt.ts`, `merchant.ts`, `rating.ts` + motivo de cancelamento `PAGAMENTO_NAO_CONFIRMADO`.
- **API:** módulos `payments/` e `merchant/`; migração `payments_merchant_rating` (com `CHECK` de nota 1–5 e valor > 0).
- **App:** `apps/mobile/src/client` (abas Pedir / Pedidos / Loja / Relatório / Conta), mesma identidade visual e componentes do app do motorista.
- **Testes:** shared 133 (+24), api 47 unitários (+9) e **89 de integração** (+35: cartão, Pix, vencimento, estorno, idempotência, recibo, avaliação, comerciante, exclusão de conta), **mobile 150** (+53). Fluxo conferido ponta a ponta contra a API real (Pix → pago → recibo → cancelar → estornado).

**Como rodar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..     # migração nova: payments_merchant_rating
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm --filter @amma/api test:int
pnpm --filter @amma/mobile test
```

Para ver o fluxo no celular: `docs/MOBILE.md` roteiro F. Nenhuma variável nova é obrigatória (`PAYMENT_PROVIDER=sandbox` é o padrão).

**Falta / pendências**

- **Não há provedor de pagamento real.** Precisa contratar um parceiro regulado (Pix + cartão), implementar `PaymentProvider`, ligar o **webhook** a `PaymentsService.confirmPix` e trocar a tokenização do sandbox pelo **SDK do provedor** no app (hoje o app manda o cartão de teste à rota `/payments/sandbox/card-tokens`; com `sandbox=false` o cartão fica indisponível de propósito). Pix pago **depois** de vencer hoje só devolve 409 no sandbox; com provedor real é preciso estornar esse pagamento tardio.
- **Estorno de entrega concluída** (disputa) não existe: exige estorno persistido no ledger e decidir o que acontece com o repasse do motorista.
- **Multa/ressarcimento de cancelamento:** o cliente é sempre estornado por inteiro; o motorista que já se deslocou não recebe nada. Regra a definir com a associação.
- **Nota fiscal:** o recibo diz que não é nota fiscal. Se o comerciante precisar de documento fiscal, é outra frente (contador/parceiro).
- **Endereço:** usa o geocodificador do aparelho; sem autocomplete, sem escolher entre resultados, sem ajustar o pino no mapa. Endereço ambíguo pode cair no lugar errado (o mapa de confirmação existe para o cliente perceber). Para algo melhor: Mapbox/Google Places no servidor.
- **Avaliação:** só o cliente avalia o motorista; não há média exibida ao motorista, avaliação do motorista sobre o cliente, nem uso da nota no despacho (decisão de produto).
- **Push para o cliente** (pedido aceito, a caminho, entregue) não existe; o cliente depende do app aberto + tempo real/consulta. `PushToken` hoje é só do motorista.
- Nada foi testado em **aparelho físico** (mapa real, geocodificação do Android, “usar minha localização”, compartilhar código/recibo). Roteiro F em `docs/MOBILE.md`.
- Relatório do comerciante é só em tela (sem exportar CSV/PDF). Um usuário COMERCIANTE + PASSAGEIRO vê o mesmo histórico (é a mesma conta).
- A rotina de Pix vencido/estorno roda no mesmo `tick` do despacho (`DISPATCH_TICK_MS`); com `0` (só testes) ela não roda sozinha.
- Mesmas pendências da Etapa 5 sobre fonte Outfit, ícone/splash, leitor de tela e tema escuro; `Field` agora tem `accessibilityLabel`, mas o resto da acessibilidade não foi revisado.
