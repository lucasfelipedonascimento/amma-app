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

## Etapa 7 — Corridas de passageiro (carro e moto) ✅ (sem teste em celular real)

**Feito** (detalhes em `docs/API.md` seção 13, `docs/DECISOES.md`, `docs/LGPD.md` e `docs/MOBILE.md` roteiro G)

- **Pedir corrida:** origem, destino, tipo de veículo → **estimativa por tipo** (preço, tempo de viagem e quanto o motorista mais próximo leva para chegar) → pagamento (Pix/cartão de teste) → confirmação. O preço mostrado é o cobrado (`expectedFareCents`). Tipos que a configuração municipal não libera nem aparecem.
- **Reaproveitamento:** a corrida é um `Delivery` com `kind = CORRIDA` — mesmos estados, oferta, aceite, pagamento, estorno, cancelamento, recibo e fechamento no ledger (10% + associação 0/2/4%, cotas). Ajustes: tabela de preço por perfil (`CORRIDA_CARRO`/`CORRIDA_MOTO`), despacho só para quem tem veículo do tipo pedido dentro das regras municipais, textos por tipo, ganhos/histórico do motorista incluem corridas.
- **Segurança:**
  - **Verificação:** o passageiro vê nome, nota, **foto, placa e modelo** do veículo que aceitou e um **PIN de embarque**; o motorista só embarca digitando o PIN (5 tentativas).
  - **Compartilhar viagem** com um contato por link (sem login, só o essencial, revogável, expira 30 min depois).
  - **Emergência** (passageiro e motorista): registra alerta com a posição, avisa os admins em tempo real e liga para 190/192/193 (o aviso à associação falhar não impede a ligação).
  - **Motorista mulher:** autodeclaração + conferência da associação; quando pedido, só elas recebem — sem cair em outro motorista.
  - **Avaliação mútua:** passageiro avalia motorista e motorista avalia passageiro; cada um vê só a média (a partir de 3 notas) do outro.
  - **Denúncia** com categorias, ligada à corrida (o denunciado é sempre a outra parte), resposta da associação visível a quem denunciou, fila do admin com graves primeiro.
  - **Registro da viagem:** trajeto do veículo gravado só nas corridas, guardado 90 dias (exceto com denúncia/alerta), acesso do admin auditado.
- **Regras municipais como configuração:** `MunicipalRulesVersion` (idade máxima do veículo e idade mínima do motorista por tipo, documentos exigidos — inclusive novos: antecedentes, licença municipal, seguro —, avisos ao passageiro, mototáxi ligado/desligado, opção motorista mulher), versionadas, com vigência, publicadas por `POST /admin/municipal-rules`. Sem versão vale um padrão **marcado como não confirmado**: carro liberado, **mototáxi desligado**.
- **App:** aba **Corrida** do passageiro (pedir, acompanhar com cartão do motorista/PIN/compartilhar/emergência/denunciar/avaliar, corridas recentes); motorista: oferta e corrida com passageiro e nota, campo de PIN, emergência, denúncia, avaliação do passageiro e, na aba Conta, **habilitação por veículo**, envio dos documentos que faltam e declaração de gênero.
- **Testes:** shared **165** (+32), api **55** unitários e **162** de integração (+73: estimativa, despacho por tipo/regra/preferência, PIN, ledger de corrida, avaliação mútua, link público, emergência, denúncia, registro/retenção/auditoria, regras municipais, perfis de preço, exclusão de conta), mobile **193** (+43).

**Como rodar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..     # migração nova: rides_safety_municipal
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm --filter @amma/api test:int
pnpm --filter @amma/mobile test
```

Variável nova: `PUBLIC_BASE_URL` (links de compartilhar; padrão `http://localhost:3000`). O seed ganhou tabelas de preço **de exemplo** das corridas e o motorista de carro `+5583999990007` (mulher verificada). O mototáxi nasce desligado: para testar moto, publique uma versão das regras com `moto.enabled: true` (`POST /admin/municipal-rules`, exemplo em `docs/API.md` 13.6). Roteiro no celular: `docs/MOBILE.md` roteiro G.

**Falta / pendências**

- **A lei de João Pessoa não foi informada e não foi inventada.** Idade máxima do veículo (10 carro / 8 moto), idade mínima do motorista (21) e a lista de documentos do padrão são **exemplos**. **Precisa da associação/jurídico:** o que a legislação municipal exige de carro e de mototáxi (se o mototáxi pode operar por app, idade do veículo, documentos, seguro, licença/cadastro na prefeitura), e então publicar a versão. Até lá a API e o app avisam “regras NÃO confirmadas” e a moto fica desligada.
- **“Verificação da placa e do motorista” é documental + visual.** Aprovamos o CRLV/CNH/foto por revisão do admin e o passageiro confere foto, placa e PIN. **Não há consulta a base oficial** (Senatran/Detran, antecedentes) nem reconhecimento facial/“selfie na hora” para provar que quem dirige é quem aprovou. Se a associação quiser, é integração com parceiro.
- **Emergência sem equipe por trás:** o alerta chega ao admin por WebSocket e fica listado em `GET /admin/safety/alerts`, mas **não existe painel nem plantão**; ninguém é acionado se não houver um admin conectado/olhando. A associação precisa definir quem atende e em quanto tempo (e talvez notificar por SMS/WhatsApp/e-mail). O link do contato mostra a faixa de emergência, mas a AMMA não liga/avisa o contato por conta própria.
- **Compartilhar viagem:** o link vai pelo menu do sistema; **o app ainda não tem botão de revogar** (a API tem) nem lista de links. Posição no link só atualiza a cada ~10 s e depende do motorista enviando posição.
- **Painel web do admin continua inexistente:** denúncias, alertas, registro da viagem, verificação de gênero, regras municipais e revisão dos documentos novos são **só por API**.
- **Motorista mulher:** como a associação confere a autodeclaração (documento? presencial?) é decisão dela; hoje é um `POST` do admin. Pode demorar mais para achar motorista: talvez `maxSearchSeconds` maior para esses pedidos. A opção é aberta a qualquer passageiro.
- **Avaliação não tem efeito:** a nota só informa (média a partir de 3 notas); não entra no despacho, não bloqueia ninguém e não há tratamento de nota baixa/denúncia reincidente (suspender motorista não existe).
- **Cancelamento sem multa** (herdado): se o passageiro cancela depois de o motorista ter ido buscá-lo, o motorista não recebe nada e o passageiro recebe estorno total. Mais sentido numa corrida do que numa entrega; regra a definir com a associação.
- **Registro da viagem:** 90 dias é palpite; confirmar com o jurídico, atualizar a política de privacidade (hoje o aviso só está na tela da corrida) e decidir se vira consentimento explícito. Só grava com o app do motorista enviando posição.
- **Rota/ETA:** com `ROUTE_PROVIDER=simulated` a rota é uma reta (tempo irreal); ETA e preço reais exigem Mapbox/Google com chave. A tela do passageiro mostra o ETA só na estimativa inicial, não um “chega em X min” ao vivo.
- **Nada foi testado em aparelho físico:** foto do motorista (`Image` com cabeçalho `Authorization` no Android), menu de compartilhar, ligação de emergência, mapa e geocodificação. Segue o roteiro G.
- Herdadas: endereço sem autocomplete, sem push para o passageiro, sem estorno de corrida concluída/disputa, sem fonte Outfit/ícone/tema escuro, WebSocket em memória (1 instância), sem provedor de pagamento real.
- Limpeza futura: remover `Ride`/`QuotaAccount`/`QuotaEntry` (sem uso) e, se valer o esforço, renomear `Delivery` para algo neutro.

## Etapa 8 — Módulo da associação ✅ (sem teste em celular real)

**Feito** (detalhes em `docs/API.md` seção 14, `docs/REGRAS_FINANCEIRAS.md` seção 8, `docs/DECISOES.md` e `docs/MOBILE.md` roteiro H)

- **Taxa, cotas e nível:** escolha de 0/2/4% (rota que já existia, agora na aba **AMMA**), cotas e fração lidas do ledger, nível Bronze/Prata/Ouro e **progresso até o próximo** (cotas e valor que faltam, barra). Sócio = ao menos 1 cota.
- **Assembleia:** o admin abre propostas (prazo 24 h–60 dias, quórum opcional); **1 sócio = 1 voto**; o sócio **muda o voto até o fechamento**; fechamento único e seguro contra corrida; resultado (aprovada/rejeitada/sem quórum) com contagem só depois de encerrar e `ballotDigest`; **histórico imutável** (`VoteRecord`) e proposta encerrada travada pelo banco.
- **Compra coletiva:** grupos de veículos, **fila por cotas e tempo** com regras **configuráveis por votação** (proposta `REGRA_COMPRA_COLETIVA` aprovada cria uma nova versão), entrar/sair, **aportes registrados como lançamentos** no ledger (`GROUP_CONTRIBUTION`), contemplação pela associação. **Sem dinheiro real:** o parceiro (consórcio/cooperativa) é uma interface simulada (`PurchasePartner`).
- **Seguro mútuo:** pedido, anexos (JPG/PNG/PDF), linha do tempo, e **decisão humana** com motivo obrigatório; quem pediu não decide o próprio pedido.
- **Sobras anuais:** cálculo proporcional ao **uso** e às **cotas** (peso do uso configurável), exato ao centavo; **simulação obrigatória** antes do fechamento (checksum), uma vez por ano, lançamento `SURPLUS_DISTRIBUTION` no ledger.
- **App:** aba **AMMA** no app do motorista (Resumo · Assembleia · Compra · Seguro).
- **Seed:** `...0003` e `...0007` viram sócios de exemplo (12 e 35 cotas); um grupo e uma proposta de exemplo.
- **Testes:** shared **232** (+67), api **60** unitários e **285** de integração (+123), mobile **233** (+40). Bundle Android conferido com `expo export`.

**Como rodar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..     # migração nova: associacao
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm --filter @amma/api test:int
pnpm --filter @amma/mobile test
```

Variáveis novas (opcionais): `PURCHASE_PARTNER=sandbox` e `ASSOCIATION_TICK_MS=30000`. Roteiro no celular: `docs/MOBILE.md` roteiro H.

**Falta / pendências**

- **Decisões da associação que o código assumiu (estão como exemplo/padrão e precisam ser confirmadas):** quem é sócio (hoje: ≥ 1 cota — quem escolhe 0% não vota); quem pode propor (hoje só o admin); quórum e maioria; os pesos e o mínimo da fila e o aporte mínimo (10 / 1 / 1 cota / R$ 50,00); o peso do uso nas sobras (50%); se as sobras viram saldo a pagar (como está) ou cotas; se o contemplado precisa estar em dia com os aportes.
- **Nenhum parceiro real:** consórcio/cooperativa de crédito não foi contratado. É preciso implementar `PurchasePartner`, definir a conciliação (o que o parceiro confirma depois, devoluções, desistência com aportes) e como o contemplado recebe o veículo. Hoje quem tem aportes não consegue sair da fila pelo app.
- **Seguro mútuo sem fundo nem pagamento:** aprovar só registra o valor. Faltam: regulamento (coberturas, carência, limites, prazo para pedir), de onde sai o dinheiro (fundo? seguradora parceira?) e o pagamento ao sócio. Pode exigir regulação (SUSEP) — **consultar o jurídico antes de operar**.
- **Sobras:** o valor a distribuir é digitado pelo admin; não há contabilidade da associação no sistema. Não há estorno do fechamento (errou = lançamento corretivo decidido pela associação). Uso = valor bruto concluído (não considera cancelamentos pós-entrega, que ainda não existem).
- **Admin só por API:** abrir proposta, criar grupo, contemplar, decidir seguro e fechar sobras não têm painel (continua o `apps/admin` pendente). Não há lista de quem votou nem de quem é sócio para o admin.
- **App:** sem push/aviso de nova votação ou de decisão do seguro (o sócio só vê ao abrir a aba); anexos só da galeria (sem câmera, sem PDF pelo app); pedido de seguro sem edição. Nada testado em aparelho físico (roteiro H).
- **Votos nominais** ficam no banco para auditoria; definir quem acessa e como se registra (ver `docs/LGPD.md`).
- Rotina de fechamento roda a cada 30 s; a proposta também fecha ao ser lida. Sem notificação de resultado.
- Herdadas das etapas anteriores: sem provedor de pagamento real, sem estorno persistido de corrida concluída, WebSocket em memória, sem fonte Outfit/ícone/tema escuro.

## Etapa 9 — Pontos de acolhida ✅ (sem teste em celular real)

**Feito** (detalhes em `docs/API.md` seção 15, `docs/REGRAS_FINANCEIRAS.md` seção 9, `docs/DECISOES.md` e `docs/MOBILE.md` roteiro I)

- **Cadastro:** espaço público, casa parceira e comércio, com nome, endereço, bairro, referência, **horário** (24 h ou faixas por dia, inclusive a que vira a noite), **comodidades** (água, banheiro, carregador, descanso, Wi-Fi, comida, estacionamento), **capacidade** (1–50) e até **6 fotos** (JPG/PNG). O dono edita horário, comodidades, capacidade e benefício, e pode remover o ponto.
- **Mapa:** pontos ao redor com filtros por **tipo, comodidades, distância, aberto agora e nota mínima**, ordenados do mais perto, com lotação (`occupied` de `capacity`) e nota (média a partir de 3 avaliações).
- **Check-in:** só do motorista, a até 200 m do ponto, ponto aberto e com vaga, um por vez, 6 h entre visitas ao mesmo ponto; fecha sozinho em 4 h; só conta com 5 min ou mais. A posição do aparelho não é guardada.
- **Avaliação dos dois lados:** o motorista avalia o ponto; o anfitrião avalia o motorista (uma por visita e direção, até 7 dias). Mesma privacidade das corridas: ninguém vê o comentário que recebeu.
- **Casa parceira:** **checklist de segurança** (6 itens obrigatórios) → fila de análise → **aprovação do admin** só com identidade e local conferidos (motivo e linha do tempo imutável; quem cadastrou não decide a própria casa). No mapa aparece só o bairro e uma posição aproximada; o endereço completo vai ao dono, ao admin e a quem está com check-in lá.
- **Benefício ao anfitrião:** R$ 1,00 por visita que conta, teto de R$ 30,00 por ponto por mês, em **crédito** (saldo) ou **desconto** acumulado, como lançamento `HOST_BENEFIT` no ledger na mesma transação da saída.
- **Denúncia e remoção:** denúncia com categoria (uma aberta por pessoa por ponto, 5 por dia); **suspensão automática** por denúncia grave, 3 denunciantes ou nota média < 2,0 com 5+ avaliações; o admin resolve a denúncia (e pode remover junto), remove, ou reativa um ponto suspenso, sempre com motivo. Quem denunciou acompanha a resposta.
- **App:** aba **Acolhida** no app do motorista (Mapa · Cadastrar · Meus · Visitas), com o check-in aberto e “Sair do ponto” no topo.
- **LGPD:** exclusão de conta remove nome/endereço/checklist/fotos dos pontos da pessoa e apaga seus comentários de avaliação; ver `docs/LGPD.md`.
- **Seed:** 4 pontos de exemplo (praça, padaria, casa aprovada, casa em análise).
- **Testes:** shared **253** (+21), api **67** unitários e **329** de integração (+44), mobile **265** (+32). Bundle Android conferido com `expo export`.

**Como rodar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..     # migração nova: pontos_acolhida
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm --filter @amma/api test:int
pnpm --filter @amma/mobile test
```

Sem variável de ambiente nova. Roteiro no celular: `docs/MOBILE.md` roteiro I.

**Falta / pendências**

- **Decisões da associação que o código assumiu (exemplos a confirmar):** quem pode cadastrar ponto (hoje qualquer pessoa logada; só o admin aprova casa); o valor do benefício (R$ 1,00/visita, teto R$ 30,00/mês por ponto) e se vale também para comércio; os limites de suspensão (grave, 3 denunciantes, média < 2,0 com 5 notas); o raio de 200 m, os 5 min mínimos, as 4 h e as 6 h entre visitas; os itens do checklist.
- **O desconto não abate nada ainda:** `HOST_DISCOUNT` só acumula. Falta definir de onde sai (taxa base? taxa de associação? corridas do anfitrião, que pode nem ser motorista) e como se aplica. O **crédito** cai em `WORKER_BALANCE`, que só tem tela no app do motorista.
- **Conferência da casa é manual e fora do app:** o admin marca “identidade conferida” e “local conferido”, mas o sistema não guarda documento nem foto dessa conferência. Definir o procedimento (visita? documento? foto da fachada?) antes de operar.
- **Anti-fraude do benefício é básico:** raio de 200 m, 5 min, 6 h entre visitas, teto mensal e anfitrião ≠ visitante. Combinar dois aparelhos/contas (visitante e anfitrião da mesma pessoa) não é detectado; a posição do aparelho pode ser falsificada.
- **Posição aproximada ≠ anonimato:** quem faz check-in vê o endereço completo e o anfitrião vê o primeiro nome do visitante. Rever o aviso ao anfitrião na política (ver `docs/LGPD.md`).
- **Admin só por API:** aprovar, recusar, remover, reativar e resolver denúncias não têm painel (`apps/admin` segue pendente) e **não há aviso** ao admin de casa nova ou denúncia grave (o admin precisa consultar a fila) nem ao dono quando o ponto é suspenso, aprovado ou recusado (ele vê ao abrir “Meus”).
- **App:** horário de funcionamento só por modelos prontos; posição do ponto marcada pela localização atual ou pelo geocodificador do aparelho (sem arrastar o pino); fotos só da galeria; sem rota até o ponto (abrir no app de mapas); sem “favoritos” nem aviso de ponto novo por perto. Nada testado em aparelho físico (roteiro I).
- **Mapa:** raio por faixa de latitude/longitude em `Float` e distância em `shared`, sem índice espacial. Com milhares de pontos, migrar para uma coluna PostGIS.
- **Ponto sem anfitrião não tem “dono” operacional:** espaço público cadastrado por alguém fica sob o cadastrante (que pode editar/remover) e, se a pessoa excluir a conta, o ponto é removido. Definir se o admin “adota” esses pontos.
- Herdadas das etapas anteriores: sem provedor de pagamento real, parceiro de compra/seguro e fundo ainda por definir, WebSocket em memória, sem fonte Outfit/ícone/tema escuro.

## Etapa 10 — Painel admin ✅ (testado no navegador só por requisições HTTP, sem teste visual)

**Feito** (detalhes em `docs/API.md` seção 16, `docs/DECISOES.md`, `docs/ARQUITETURA.md`)

- **`apps/admin`** (Next.js 15): entrada por celular + código; sessão em cookies `httpOnly`; proxy para a API; menu e páginas por papel.
- **Papéis:** `ADMIN` faz tudo; **sócio** (motorista com ≥1 cota) só lê **assembleias e resultados, fila da compra coletiva e orçamento aberto**. Quem não é um dos dois não ganha sessão. A API confere de novo em cada rota (nega por padrão).
- **Aprovações:** motoristas e seus documentos (abre o arquivo, aprova ou reprova com motivo), **comerciantes** (novo `approvalStatus`), **pontos de acolhida** (aprovar com conferência de identidade e local, recusar, remover, reativar) e denúncias de pontos.
- **Painel inicial:** pedidos e corridas (concluídos, cancelados, em andamento, taxa de conclusão), ganho médio líquido por trabalhador e por corrida, sócios/cotas/níveis, fundo de cotas, aportes da compra coletiva, receita da taxa base, satisfação (clientes × motoristas × pontos) e fila do que está esperando a associação; período de 7/30/90 dias.
- **Assembleias:** propostas, resultados com barras e selo de conferência, abrir proposta. **Compra coletiva:** grupos, fila por pontos, contemplados, criar grupo, contemplar e encerrar.
- **Denúncias e alertas de emergência** (fila por gravidade, assumir/encerrar alerta, responder denúncia) com atalho para bloquear o denunciado.
- **Bloqueios com motivo e direito de recurso:** a pessoa bloqueada vê o motivo e recorre (uma vez, em 30 dias); **outro** admin decide com justificativa; o admin revoga quando quiser. Conta bloqueada é barrada na API inteira (e sai do ar), menos ver o motivo, recorrer e excluir a conta.
- **Trilha de auditoria:** interceptor global grava toda escrita e a abertura de dado sensível em `/admin/*`, somente inserção (o banco recusa editar), com filtro por ação e datas e paginação.
- **Orçamento aberto:** receita da taxa base do ledger + lançamentos do admin (receitas e despesas por categoria, imutáveis, estorno), resumo por categoria e mês, visível ao sócio.
- **Testes:** shared **286** (+33), api **67** unitários e **353** de integração (+24, `test/backoffice.int.test.ts`: papéis, bloqueio/recurso/revogação, imutabilidade no banco, trilha, orçamento, métricas), admin **42** (formulário, sessão, middleware, proxy, login, menu por papel). Verificado de verdade: API + `next start`, login do admin e do sócio, páginas, bloqueio pelo proxy aparecendo na auditoria.

**Como rodar**

```
pnpm install && pnpm db:up
cd apps/api && pnpm prisma:deploy && pnpm db:seed && cd ../..     # migração nova: painel_admin
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm --filter @amma/api test:int
node apps/api/dist/main.js                    # API em :3000
pnpm --filter @amma/admin dev                 # painel em http://localhost:3001
```

Admin do seed `+5583999990001`; sócio `+5583999990003` (o código aparece na tela no modo simulado). Variável nova: `ADMIN_API_URL` (padrão `http://localhost:3000`).

**Falta / pendências**

- **O app do celular não mostra o bloqueio nem tem tela de recurso.** Uma conta bloqueada recebe `403 ACCOUNT_BLOCKED` e o app mostra erro genérico; a API já tem `GET /me/block` e `POST /me/block/appeal` para a tela. Também **não há aviso** (push/SMS) à pessoa de que foi bloqueada nem de que o recurso foi decidido.
- **Recusa de comerciante não impede pedir entrega** (ver `docs/DECISOES.md`): decidir se vira checagem no pedido ou se a associação usa o bloqueio da conta.
- **Bloqueio não encerra o que está em andamento:** uma entrega já aceita continua com o motorista bloqueado até alguém cancelar; o token de acesso vigente (até 15 min) é barrado na hora porque o banco é consultado a cada chamada.
- **Equipe com permissões por área** (moderador, financeiro) não existe: quem é `ADMIN` faz tudo. O prazo de 30 dias do recurso é exemplo a confirmar.
- **Auditoria:** não registra a leitura das listas (nomes e telefones) e, se a gravação falhar, a ação já aconteceu (só vai ao log). Falta prazo de guarda (ver `docs/LGPD.md`).
- **Orçamento:** comprovante é só um texto (o arquivo não é guardado); só `ADMIN` lança, sem dupla aprovação; não há exportação (CSV/PDF) nem comparação entre anos; não existe fundo do seguro (os pedidos de seguro, sobras e regras municipais seguem **só por API**, sem tela no painel).
- **Painel:** sem teste visual em navegador (só HTTP e testes de componente), sem fonte Outfit embutida, sem tema escuro, sem aviso de fila nova; a lista de motoristas traz até 500 (sem paginação) e a de usuários até 50 (busca por nome/telefone). Atualização é por recarregar a página.
- **Deploy:** `ci-admin.yml` roda lint/typecheck/test/build; `deploy-admin.yml` é esqueleto. Em produção o painel precisa de HTTPS (cookies `Secure` já ligados) e `ADMIN_API_URL` apontando para a API.
- Herdadas: sem provedor de pagamento real, parceiro de compra/seguro e fundo por definir, WebSocket em memória, alertas de emergência sem equipe de plantão (o painel agora lista, mas ninguém é acionado).

## Etapa 11 — Preparar para produção 🟡 (só auditoria e checklist; sem código)

**Feito**

- `docs/CHECKLIST_LANCAMENTO.md`: estado real de cada item (✅/🟡/❌/👤) em segurança (OWASP e limites de taxa), logs sem dado pessoal, LGPD, criptografia e backup, CI/CD e ambientes, observabilidade, testes ponta a ponta e publicação Google Play/App Store (inclui justificativa da localização em segundo plano), com ordem sugerida e critério de "pronto".

**Achados principais**

- API sem `helmet`, CORS explícito, limite de taxa geral nem validação de ambiente; `AuthGuard` é por controller (não global).
- Não existe exportação de dados do titular; política de privacidade é placeholder; não há termos de uso.
- Deploys são esqueleto; não há staging, Dockerfile, Sentry, `eas.json`, ícones nem capturas.
- O app não tem tela de bloqueio/recurso; emergência continua sem plantão.

**Falta:** implementar os itens das seções A–I do checklist (próxima etapa de código) e as ações 👤 (contas de loja, jurídico, provedores).

## Auditoria de segurança 🟡 (em andamento, por partes) — ver `docs/SEGURANCA.md`

**Parte 1 — autenticação e sessões ✅ (2026-10-30)**

- Fase 1 (reconhecimento) apresentada e aprovada; escolhas do usuário: reautenticação por OTP (não TOTP), bloqueio do `ENTREGUE` a mais de ~300 m do destino, correções feitas por partes.
- Corrigido: corrida na contagem de tentativas do OTP (H2, confirmada com teste), limite de taxa geral/por rota/por usuário e cabeçalhos de segurança (H1), reautenticação por OTP nas ações críticas do admin, inclusive no painel (H3), guard global de negar por padrão (H5), JWT com `iss`/`aud`/algoritmo e segredo forte em produção (H6), `POST /auth/logout-all` (H7).
- Testes: `test/auth-security.int.test.ts` (14), `jwt-config.test.ts`, `security-headers.test.ts`, 1 de componente no painel. Total: 367 de integração, 71+ unitários na API, 43 no painel, todos verdes; lint e typecheck limpos.
- Variáveis novas: `TRUST_PROXY`, `RATE_LIMIT_SCALE`. Em produção `JWT_SECRET` precisa de 32+ caracteres.
- **Para quem usa a API:** ações críticas do admin agora respondem `403 REAUTH_REQUIRED` até `POST /auth/reauth/request` + `/verify`. Scripts/testes que chamam essas rotas precisam reautenticar (helper `t.admin()` já faz).

**Parte 2 — autorização e fraude ✅ (2026-10-30)**

- Matriz de testes IDOR/BOLA (`test/authz-fraud.int.test.ts`, 22 testes): sem IDOR nem escalada de privilégio encontrados.
- Corrigido: concluir entrega/corrida sem estar no destino (A2; agora exige até 300 m e posição recente do servidor) e auto-atendimento do próprio pedido por quem tem os dois papéis (A1). Ambas reproduzidas com teste antes da correção.
- Testes antigos que concluíam sem posição foram ajustados (helper `t.atDropoff`). Total: 389 de integração, 77 unitários na API, 286 no shared; lint e typecheck limpos.
- **Para o app do motorista:** `delivered` pode responder `409` com `TOO_FAR_FROM_DROPOFF`/`POSITION_UNKNOWN` (a mensagem em português já vem pronta e o app a exibe). Tratado no app (2026-10-30): longe do destino a tela mostra a distância e desabilita "Confirmar entrega"; sem GPS o botão fica liberado e o servidor decide.

**Parte 3 — WebSocket, localização, arquivos e LGPD ✅ (2026-10-30)**

- Corrigido (cada item reproduzido por teste antes): conexão WebSocket sobrevivia a bloqueio/exclusão/logout, sem limite nem checagem de origem (W1); consentimento de localização não exigido no servidor e revogação sem efeito imediato (P1); `GET /me/export` inexistente (L1); PDF com conteúdo ativo aceito (U1); sem teto de documentos (U2); download do admin sem isolamento (U3); telefone no log do OTP simulado (L2).
- Testes: `test/privacy.int.test.ts` (11). Total: 400 de integração, 77 unitários na API; lint e typecheck limpos.
- Variável nova: `WS_REVALIDATE_MS`. O app do motorista já pedia o consentimento antes de ficar online, então nada muda no fluxo; um `403 LOCATION_CONSENT_REQUIRED` só aparece se o servidor não tiver o registro.
- Checklist de lançamento: ✅ exportação dos dados, ✅ consentimento de localização no servidor.

**Parte 4 — Infra, mobile, painel, dependências e CI ✅ (2026-10-30)**

- Corrigido: `multer` com DoS (D1) e demais avisos de dependências por `pnpm.overrides` (D2), vitest 4 (D3); Postgres/Redis do compose só em `127.0.0.1` (I1); a API recusa subir em produção com credencial padrão, sem Redis ou sem https público (I2); app mobile exige `https://` em produção e sem backup no Android (M1); CSP, Permissions-Policy e HSTS no painel (A1); `permissions: contents: read` nos workflows e `security.yml` com `pnpm audit` (C1).
- `pnpm audit --prod`: 1 _low_ restante, sem correção publicada.
- Testes novos: `prod-config.test.ts` (API), `api-url.test.ts` (mobile). Total: 400 de integração, suítes unitárias e de painel/mobile verdes; lint, typecheck e build do painel limpos.
- **Auditoria concluída.** Pendências finais em `docs/SEGURANCA.md` (consolidado no fim).

## Trocar o simulado pelo real — integração 1: mapas e rotas (2026-10-30)

- O adaptador do Mapbox já existia; faltava proteger o gasto. Novo `GuardedRouteProvider` (em volta do Mapbox/OSRM): **cache** de rotas repetidas (chave com 4 casas decimais ≈ 11 m; só rotas sem traçado) e **teto diário** de consultas pagas (`ROUTE_DAILY_LIMIT`, dia UTC, aviso em 80%, recusa acima do teto com `RouteUnavailableError`, que a cotação traduz em 503 e o ETA da oferta ignora). Redis fora do ar: segue sem cache nem teto.
- Em produção com `ROUTE_PROVIDER=mapbox` a API só sobe com `ROUTE_DAILY_LIMIT > 0`. Variáveis novas: `ROUTE_DAILY_LIMIT`, `ROUTE_CACHE_TTL_SECONDS`.
- **Falta (👤 você):** criar a conta Mapbox, gerar um token **só com escopo de Directions** (restrito, nunca commitar), definir o **limite de gastos no painel do Mapbox** (o teto de verdade; o da API é uma segunda trava) e testar com `ROUTE_PROVIDER=mapbox` em desenvolvimento. O Mapbox não tem "sandbox": o modo de teste é o nível gratuito com token próprio. Nada foi chamado com chave real aqui.
- Fora desta etapa: autocomplete/geocodificação no servidor (hoje é do aparelho) e mapa do app (segue `react-native-maps`).
- Próximas integrações, uma por vez: Pix/cartão com divisão de pagamento → SMS/WhatsApp para o OTP → parceiro financeiro.

## Trocar o simulado pelo real — integração 2: Pix e cartão com divisão (2026-10-30)

Foco combinado: deixar tudo pronto para conectar o provedor depois (nenhuma chamada real feita).

- `PaymentProvider` ganhou `settleSplit` (repasse ao trabalhador, taxa base e associação, feito **depois do ENTREGUE**, com as taxas congeladas no pedido) e `parseWebhook` (valida assinatura e traduz o aviso). O sandbox implementa os dois (assinatura HMAC no cabeçalho `x-amma-signature`).
- `buildPaymentSplit` (shared): divisão que obrigatoriamente fecha com o valor cobrado.
- `POST /payments/webhook` (público, protegido pela assinatura): Pix pago confirma o pagamento e dispara o despacho; aviso repetido é ignorado (`PaymentWebhookEvent`); **Pix pago depois de vencer é estornado sozinho** (pendência antiga resolvida).
- Repasse que falha não bloqueia a conclusão; a rotina periódica repete. Migração `20261105120000_payment_split_webhook` (rode `prisma:deploy`).
- Registro de provedores (`REAL_PROVIDERS`) e `PAYMENT_WEBHOOK_SECRET` obrigatório em produção. Passo a passo: `docs/INTEGRACAO_PAGAMENTO.md`.
- **Falta:** escolher/contratar o provedor, cadastro das subcontas dos motoristas, SDK de cartão no app, chargeback.
