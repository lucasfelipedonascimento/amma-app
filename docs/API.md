# API — pedidos de entrega (Etapa 4) e app do motorista (Etapa 5)

Base: `http://localhost:3000` (`API_PORT`). JSON em UTF-8. Dinheiro em **centavos**, distâncias em **metros**, tempos em **segundos**, datas em **ISO 8601 UTC**. Autenticação: `Authorization: Bearer <accessToken>` (login por OTP em `/auth/otp/*`, ver `docs/PROGRESSO.md`).

Erros seguem o padrão do Nest: `{ "statusCode": 409, "message": "...", "error": "Conflict" }`. Códigos usados: `400` dado inválido, `401` sem login, `403` papel/ator errado, `404` não existe **ou você não tem acesso** (não revela existência), `409` conflito de estado, `503` rota/preço indisponível.

Os campos extras no corpo são **rejeitados** (`400`).

## 1. Estados

```
CRIADO ─► OFERECIDO ─► ACEITO ─► A_CAMINHO_COLETA ─► COLETADO ─► A_CAMINHO_ENTREGA ─► ENTREGUE
   ▲          │           │              │
   └──────────┴───────────┴──────────────┘   oferta recusada/expirada, ou motorista libera o pedido
Qualquer estado não final ─► CANCELADO (só pelos motivos e atores abaixo)
```

| Estado              | Significado                                                  |
| ------------------- | ------------------------------------------------------------ |
| `CRIADO`            | Pedido feito; procurando motorista (ou esperando o próximo). |
| `OFERECIDO`         | Há uma oferta pendente para um motorista.                    |
| `ACEITO`            | Um motorista aceitou.                                        |
| `A_CAMINHO_COLETA`  | Motorista indo buscar.                                       |
| `COLETADO`          | Item em mãos.                                                |
| `A_CAMINHO_ENTREGA` | Indo ao destino.                                             |
| `ENTREGUE`          | Concluído. **Gera o fechamento no ledger.** Final.           |
| `CANCELADO`         | Cancelado, sempre com um motivo (`cancelReason`). Final.     |

Depois de `COLETADO` o pedido **não volta** para `CRIADO`.

### Motivos de cancelamento

| `reason`                   | Quem pede | Quando                                                          |
| -------------------------- | --------- | --------------------------------------------------------------- |
| `CLIENTE_DESISTIU`         | cliente   | `CRIADO`, `OFERECIDO`, `ACEITO`, `A_CAMINHO_COLETA`             |
| `COLETA_IMPOSSIVEL`        | motorista | `A_CAMINHO_COLETA`                                              |
| `ENTREGA_IMPOSSIVEL`       | motorista | `COLETADO`, `A_CAMINHO_ENTREGA`                                 |
| `ADMIN_CANCELOU`           | admin     | qualquer estado não final; **exige** `note` (justificativa)     |
| `SEM_MOTORISTA`            | sistema   | `CRIADO`, quando acaba o tempo máximo de busca (não é chamável) |
| `PAGAMENTO_NAO_CONFIRMADO` | sistema   | `CRIADO`, quando o Pix não é pago em 15 min (não é chamável)    |

Cancelamento não gera lançamento financeiro no ledger. **Todo cancelamento devolve 100% do valor pago** (estorno automático, seção 12); multas/ressarcimentos ainda **não** existem (ver pendências).

## 2. Despacho (regras públicas)

`GET /dispatch/rules` (sem login) devolve as regras, os códigos de motivo e os parâmetros em vigor. Resumo:

1. Só recebem oferta motoristas **online**, **aprovados**, com **posição recente**.
2. Quem tem entrega em andamento ou oferta pendente não recebe outra.
3. Só entram motoristas dentro do **raio** (linha reta até a coleta, PostGIS).
4. A oferta vai para **um** motorista por vez: o **mais próximo**. Empate (em metros) → quem está online há mais tempo.
5. O motorista tem `offerTtlSeconds` para responder; sem resposta a oferta **expira** e vai ao próximo.
6. Quem já recebeu oferta **daquele pedido** (recusou, expirou, desistiu) não a recebe de novo.
7. **Recusar não pune**: nada altera ranking, contagem ou elegibilidade para outros pedidos. Expirar e ficar offline também não.
8. Passado `maxSearchSeconds` sem aceite, o pedido vira `CANCELADO` / `SEM_MOTORISTA`.
9. Toda decisão é registrada com um código de motivo.

Parâmetros (padrões; editáveis pelo admin):

| Campo                   | Padrão | Faixa     | O que é                                          |
| ----------------------- | ------ | --------- | ------------------------------------------------ |
| `radiusMeters`          | 3000   | 200–20000 | Raio de busca em torno da coleta                 |
| `offerTtlSeconds`       | 30     | 5–120     | Tempo do motorista para responder a uma oferta   |
| `maxSearchSeconds`      | 300    | 30–1800   | Tempo máximo procurando motorista                |
| `maxPositionAgeSeconds` | 60     | 10–300    | Posição mais velha que isso é considerada antiga |

### Registro de decisões

Cada decisão vira uma linha em `DeliveryEvent` (somente inserção) com `type`, `reason`, `actorId` e `data`:

| `type`           | `reason` (exemplos)                  | `data`                                                                               |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `OFERTA`         | `OFERTA_MAIS_PROXIMO`                | `distanceMeters`, `rank`, `eligible`, `inRadius`, `excluded{motivo: n}`, raio, prazo |
| `ACEITE`         | `ACEITOU`                            | `offerId`                                                                            |
| `RECUSA`         | `RECUSOU`                            | `offerId`, `declineReason?`                                                          |
| `EXPIRACAO`      | `EXPIROU`, `FICOU_OFFLINE`           | `offerId`                                                                            |
| `DESISTENCIA`    | `DESISTIU`                           | —                                                                                    |
| `SEM_CANDIDATOS` | `SEM_CANDIDATOS`, `JANELA_ESGOTADA`  | `inRadius`, `excluded{}`, raio (gravado no máximo 1×/min por pedido)                 |
| `STATUS`         | estado novo / motivo do cancelamento | `fromStatus`, `toStatus`                                                             |

Motivos de descarte contados em `excluded`: `POSICAO_ANTIGA`, `NAO_APROVADO`, `OCUPADO`, `JA_TENTADO`, `FORA_DO_RAIO`.

## 3. Cliente (`PASSAGEIRO` ou `COMERCIANTE`)

### `POST /deliveries/quote` → 200

Cotação sem criar nada. Corpo (igual ao de criar):

```json
{
  "pickup": { "lat": -7.115, "lng": -34.861, "address": "Rua da Coleta, 100" },
  "dropoff": { "lat": -7.095, "lng": -34.861, "address": "Rua da Entrega, 200" },
  "notes": "Frágil"
}
```

`lat` −90..90, `lng` −180..180, `address` 3–200 caracteres, `notes` até 280 (opcional). Coleta e entrega a menos de 20 m → `400`.

Resposta: `{ "distanceMeters": 2894, "durationSeconds": 417, "fareCents": 1100, "minimumApplied": true, "pricingVersion": "2026-11-01" }`.

O preço vem de `calculateFare` (base + km + minuto, com piso — `docs/REGRAS_FINANCEIRAS.md`) sobre a rota do provedor e a **tabela de preço vigente**. Sem tabela → `503`; provedor de rotas fora → `503`.

### `POST /deliveries` → 201

Cria o pedido, **cobra** e congela a cotação. Corpo = o da cotação mais:

```json
{
  "payment": { "method": "PIX" },
  "idempotencyKey": "tentativa-abc12345",
  "expectedFareCents": 1100
}
```

- `payment` (obrigatório): `{ "method": "PIX" }` ou `{ "method": "CARTAO", "cardToken": "…" }` (token do provedor; **o número do cartão nunca chega à API**). Detalhes na seção 12.
- `idempotencyKey` (opcional, 8–64 `[A-Za-z0-9_-]`): repetir o pedido com a mesma chave devolve o **mesmo** pedido e não cobra de novo (duplo toque, rede instável). Vale por cliente.
- `expectedFareCents` (opcional): o preço que o cliente viu. Se a tabela de preço mudou desde a cotação → `409` **antes** de cobrar.
- Cartão recusado → `402` com o motivo e **nada é criado**; provedor fora do ar → `503`.
- Cartão aprovado: o pedido nasce pago e **já tenta despachar**; a resposta traz o estado atual (normalmente `OFERECIDO` ou `CRIADO`). Pix: nasce `CRIADO` com pagamento `PENDENTE` e **só entra no despacho depois de pago**.

Resposta = visão do pedido (seção 6).

### `GET /deliveries?status=&limit=` → 200

Pedidos do próprio cliente, mais recentes primeiro (`limit` 1–100, padrão 20).

### `GET /deliveries/:id` → 200

Visível ao **cliente dono**, ao **motorista responsável** (depois de aceitar) e ao **admin**; os demais recebem `404`. Inclui `timeline` (só estados e motivo, nunca as decisões internas do despacho) e, enquanto o pedido está em andamento (`ACEITO`…`A_CAMINHO_ENTREGA`), `driverPosition` `{ lat, lng, at }` lida do Redis (para cliente/admin).

### `POST /deliveries/:id/cancel` → 200

```json
{ "reason": "CLIENTE_DESISTIU", "note": "opcional, até 280" }
```

O ator é definido pelo motivo (tabela da seção 1): `403` se você não é esse ator neste pedido, `409` se o estado não permite. Encerra ofertas pendentes e avisa o motorista (`offer.closed`).

## 4. Motorista (`MOTORISTA`)

### Presença

| Rota                            | Descrição                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /driver/presence/online`  | Corpo `{ lat, lng }`. Exige cadastro **APROVADO** (`403` com o detalhe de `approval`). Idempotente.                                       |
| `POST /driver/presence/offline` | `409` se há entrega em andamento. Oferta pendente passa ao próximo (`FICOU_OFFLINE`, sem punição). Apaga a posição do Redis e do PostGIS. |
| `GET /driver/presence`          | `{ online, onlineSince, position }`.                                                                                                      |

### Ofertas

| Rota                              | Descrição                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /driver/offers/current`      | Oferta pendente e não vencida, ou `null`.                                                                               |
| `POST /driver/offers/:id/accept`  | → 200 com o pedido. `409` se vencida, já respondida ou o pedido mudou. Só uma de várias aceitações simultâneas vence.   |
| `POST /driver/offers/:id/decline` | → 204. Corpo opcional `{ "reason": "LONGE_DEMAIS" \| "VALOR_BAIXO" \| "VEICULO_INADEQUADO" \| "OUTRO" }`. **Não pune.** |

Oferta (a que vem por REST e por WebSocket):

```json
{
  "id": "…",
  "deliveryId": "…",
  "expiresAt": "2026-10-29T21:00:30.000Z",
  "distanceToPickupMeters": 312,
  "pickupEtaSeconds": 58,
  "pickup": { "lat": -7.115, "lng": -34.861, "address": "…" },
  "dropoff": { "lat": -7.095, "lng": -34.861, "address": "…" },
  "notes": null,
  "deliveryDistanceMeters": 2894,
  "deliveryDurationSeconds": 417,
  "fareCents": 1100,
  "estimatedNetCents": 968
}
```

`estimatedNetCents` já desconta a taxa base e a **sua** taxa de associação. `pickupEtaSeconds` vem do provedor de rotas (pode ser `null` se ele falhar).

### Andamento (todas → 200 com o pedido; `409` se não for o próximo passo)

| Rota                                           | De → Para                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /driver/deliveries/:id/en-route-pickup`  | `ACEITO` → `A_CAMINHO_COLETA`                                                                  |
| `POST /driver/deliveries/:id/picked-up`        | `A_CAMINHO_COLETA` → `COLETADO`                                                                |
| `POST /driver/deliveries/:id/en-route-dropoff` | `COLETADO` → `A_CAMINHO_ENTREGA`                                                               |
| `POST /driver/deliveries/:id/delivered`        | `A_CAMINHO_ENTREGA` → `ENTREGUE` + ledger                                                      |
| `POST /driver/deliveries/:id/release`          | → 204. `ACEITO`/`A_CAMINHO_COLETA` → `CRIADO` (o pedido volta à fila e **não** retorna a você) |
| `GET /driver/deliveries/active`                | Pedido em andamento ou `null`.                                                                 |

Cada passo é um _compare-and-set_ no banco: repetir ou concorrer nunca aplica a transição duas vezes.

### Carteira e taxa de associação

- `GET /driver/wallet` → `{ "balanceCents": 968, "quotas": 0, "remainderCents": 22, "level": "BRONZE" }`, calculado a partir do ledger.
- `PUT /driver/association-rate` `{ "rate": 0 | 2 | 4 }` — vale para as próximas conclusões (exige o perfil de motorista preenchido, senão `409`).

## 5. Administrador (`ADMIN`)

| Rota                               | Descrição                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PUT /admin/dispatch-settings` | Lê/altera os 4 parâmetros do despacho (valida faixas; `400` com a lista de problemas). Vale na hora.                                                                                              |
| `GET /admin/pricing`               | Versões da tabela de preço.                                                                                                                                                                       |
| `POST /admin/pricing`              | Nova versão `{ version, effectiveFrom, baseCents, perKmCents, perMinuteCents, minimumFareCents }`. `effectiveFrom` precisa ser **posterior** à última (não reescreve o passado); `version` única. |
| `GET /admin/deliveries/:id/events` | Registro completo do pedido: estados e todas as decisões do despacho.                                                                                                                             |

Cancelamento administrativo: `POST /deliveries/:id/cancel` com `ADMIN_CANCELOU` e `note`.

## 6. Visão do pedido

```json
{
  "id": "…", "status": "ACEITO",
  "pickup": { "lat": …, "lng": …, "address": "…" }, "dropoff": { … }, "notes": null,
  "distanceMeters": 2894, "durationSeconds": 417,
  "fareCents": 1100, "minimumApplied": true, "pricingVersion": "2026-11-01",
  "cancelReason": null, "cancelNote": null,
  "createdAt": "…", "acceptedAt": "…", "pickedUpAt": null, "deliveredAt": null,
  "driver": { "id": "…", "name": "Maria" },
  "settlement": null,
  "payment": { "method": "CARTAO", "status": "PAGO", "amountCents": 1100, "pixCode": null, "pixExpiresAt": null,
               "cardBrand": "visa", "cardLast4": "4242", "paidAt": "…", "refundedAt": null, "sandbox": true },
  "rating": { "stars": 5, "comment": "…", "at": "…" },
  "timeline": [{ "status": "CRIADO", "reason": null, "at": "…" }],
  "driverPosition": null
}
```

- `driver` aparece para cliente/admin (só id e nome — **nunca telefone**); o motorista recebe `null`.
- `payment` e `rating` aparecem para **cliente e admin**; o motorista recebe `null` nos dois. `pixCode` só existe enquanto o Pix está `PENDENTE`.
- `settlement` (`platformFeeCents`, `associationFeeCents`, `workerNetCents`, `associationRate`) só existe em `ENTREGUE` e **só para motorista/admin**; o cliente não vê o repasse.

## 7. Tempo real — WebSocket `/ws`

Mensagens JSON `{ "event": "...", "data": ... }`.

1. Conecte em `ws://host:3000/ws` e envie em até **5 s**: `{"event":"auth","data":{"token":"<accessToken>"}}`. Resposta `auth.ok`. Token inválido ou sem `auth` → conexão fechada com código **4401**. (O token vai na mensagem, e não na URL, para não aparecer em logs.)
2. **Motorista online** envia posição (no máximo 1 por segundo; excedentes são descartados): `{"event":"position","data":{"lat":-7.11,"lng":-34.86}}` → `position.ok`.

   | `error.code`      | Motivo                    |
   | ----------------- | ------------------------- |
   | `UNAUTHENTICATED` | falta `auth`              |
   | `FORBIDDEN`       | não é motorista           |
   | `BAD_REQUEST`     | `lat`/`lng` inválidos     |
   | `OFFLINE`         | motorista não está online |

3. Eventos enviados pelo servidor:

   | Evento             | Para                | `data`                                                                     |
   | ------------------ | ------------------- | -------------------------------------------------------------------------- |
   | `offer.created`    | motorista           | a oferta (seção 4)                                                         |
   | `offer.closed`     | motorista           | `{ offerId, reason }` (`EXPIROU`, `RECUSOU`, `FICOU_OFFLINE`, `CANCELADO`) |
   | `delivery.updated` | cliente e motorista | `{ id, status, cancelReason? }`                                            |
   | `driver.position`  | cliente             | `{ deliveryId, lat, lng, at }` — só com entrega em andamento               |
   | `payment.updated`  | cliente             | `{ deliveryId, status }` (`PAGO`, `EXPIRADO`, `ESTORNADO`)                 |

Se um evento se perder, o REST sempre devolve o estado atual (`GET /driver/offers/current`, `GET /deliveries/:id`).

**Onde a posição fica:** a cada mensagem vai para o **Redis** (`driver:pos:<id>`, expira em 120 s sem atualização). O **PostGIS** (`DriverPresence.location`, `geography(Point,4326)` com índice GiST) recebe no máximo **1 gravação a cada 5 s por motorista**, e é ele que o despacho consulta. Guarda-se **só a última posição**, sem trajeto; ficar offline ou excluir a conta apaga tudo.

## 8. Rotas e distâncias

Interface `RouteProvider.route(origem, destino) → { distanceMeters, durationSeconds }`.

| `ROUTE_PROVIDER`     | Comportamento                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulated` (padrão) | Determinístico, sem rede: reta × 1,3, a 25 km/h. **Recusado com `NODE_ENV=production`.**                                                     |
| `mapbox`             | Mapbox Directions (`driving`), exige `MAPBOX_ACCESS_TOKEN`; timeout de 5 s; arredonda para cima; o token nunca aparece em mensagens de erro. |

O adaptador do Mapbox foi testado com respostas simuladas, **não** contra a API real (sem chave). Para usar Google Routes basta implementar a mesma interface.

## 9. Ledger

Ao `ENTREGUE`, na **mesma transação** do banco que muda o estado, grava-se uma `LedgerTransaction` `RIDE_SETTLEMENT` (referência = id do pedido) montada por `buildRideSettlement`:

```
DÉBITO  PARTNER_RECEIVABLE        1100
CRÉDITO WORKER_BALANCE:<id>        968
CRÉDITO PLATFORM_REVENUE           110
CRÉDITO WORKER_QUOTAS:<id>          22     (omitido se a taxa de associação é 0)
```

(exemplo: R$ 11,00, associação 2%.) Garantias no banco: UPDATE/DELETE em `LedgerTransaction`/`LedgerPosting` são **recusados por gatilho**; `(kind, reference)` é único (um pedido só fecha uma vez); valores `> 0`. Taxas e taxa de associação ficam congeladas no pedido.

## 10. Variáveis de ambiente novas

`REDIS_URL`, `ROUTE_PROVIDER`, `MAPBOX_ACCESS_TOKEN`, `DISPATCH_TICK_MS` (ver `.env.example`). Etapa 6: `PAYMENT_PROVIDER` (seção 12).

## 11. App do motorista (Etapa 5) — rotas de `MOTORISTA`

### `GET /driver/earnings` → 200

Tudo calculado sobre entregas `ENTREGUE`. O "dia" é o de **João Pessoa (UTC−3)**, não o UTC.

```json
{
  "associationRate": 2,
  "today": {
    "deliveries": 2,
    "grossCents": 2200,
    "platformFeeCents": 220,
    "associationFeeCents": 44,
    "netCents": 1936,
    "competitorFeeCents": 550,
    "competitorNetCents": 1650,
    "extraCents": 286
  },
  "week": {
    "days": [
      {
        "date": "2026-10-23",
        "deliveries": 0,
        "grossCents": 0,
        "platformFeeCents": 0,
        "associationFeeCents": 0,
        "netCents": 0
      },
      "… 7 dias, o mais antigo primeiro"
    ],
    "deliveries": 2,
    "grossCents": 2200,
    "netCents": 1936,
    "competitorNetCents": 1650,
    "extraCents": 286
  },
  "history": [
    {
      "id": "…",
      "deliveredAt": "…",
      "pickupAddress": "…",
      "dropoffAddress": "…",
      "fareCents": 1100,
      "platformFeeCents": 110,
      "associationFeeCents": 22,
      "workerNetCents": 968,
      "associationRate": 2
    }
  ]
}
```

`competitor*` é o comparativo com um app que cobra **25%** (taxa do concorrente arredondada para cima; `extraCents` nunca é negativo). `history`: as 30 últimas.

### `GET /driver/deliveries/:id/route?lat=&lng=` → 200

Rota da posição informada (GPS do aparelho) até o próximo ponto: **coleta** em `ACEITO`/`A_CAMINHO_COLETA`, **entrega** em `COLETADO`/`A_CAMINHO_ENTREGA`.

```json
{
  "target": "COLETA",
  "destination": { "lat": -7.115, "lng": -34.861, "address": "…" },
  "distanceMeters": 1500,
  "durationSeconds": 300,
  "path": [{ "lat": -7.12, "lng": -34.86 }, "…"]
}
```

`404` se o pedido não é seu, `409` se não está em andamento, `503` se o provedor de rotas falhar. No modo simulado o `path` é a reta entre os dois pontos; no Mapbox é a geometria real (`overview=full`).

### `POST /driver/position` `{ lat, lng }` → 200 `{ "accepted": boolean }`

Posição por REST, usada pela localização em segundo plano quando o WebSocket não está aberto. Mesmas regras do WebSocket (só online; no máximo 1/s por motorista; PostGIS 1×/5 s). `accepted: false` = o servidor não considera o motorista online → o app **para** de enviar.

### Consentimento de localização (LGPD)

| Rota                              | Descrição                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /driver/location-consent`    | `{ version, granted, grantedAt }` para a versão vigente (`LOCATION_CONSENT_VERSION` no `shared`). |
| `POST /driver/location-consent`   | `{ version }`. `400` se a versão for velha. Idempotente (não duplica o registro).                 |
| `DELETE /driver/location-consent` | → 204. Revoga: apaga os registros desse consentimento.                                            |

O servidor **não** impede `presence/online` sem consentimento (o contrato da Etapa 4 segue igual); quem exige é o app. Ver pendências.

### Push

| Rota                        | Descrição                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /driver/push-token`    | `{ token: "ExponentPushToken[…]", platform: "android" \| "ios" }` → 204. O token muda de dono se outra pessoa entra no aparelho. |
| `DELETE /driver/push-token` | Mesmo corpo → 204. Só apaga se o token for seu.                                                                                  |

A cada **nova oferta** o motorista recebe um push (título "Novo pedido de entrega", corpo "Você recebe R$ 9,68 · corrida de 2,9 km", `data: { type: "offer", offerId }`, prioridade alta, canal Android `offers`, `ttl` = tempo que falta para a oferta vencer). **Sem endereços**: a tela bloqueada é pública. Enviado em paralelo ao WebSocket; falha no push nunca atrapalha o despacho. Tokens que o Expo diz não existirem mais (`DeviceNotRegistered`) são apagados.

Variáveis: `PUSH_MODE` (`simulated` padrão — só registra no log, **recusado em produção** — ou `expo`) e `EXPO_ACCESS_TOKEN` (opcional).

## 12. Pedir entrega, pagamento e comerciante (Etapa 6)

### Pagamento

A AMMA **não custodia dinheiro**: o provedor de pagamento cobra e estorna; a API guarda só o estado (`Payment`) e, do cartão, bandeira + 4 últimos dígitos. O provedor é uma interface (`PaymentProvider`: `createPix`, `chargeCard`, `refund`; `refund` é idempotente por cobrança). Hoje só existe o **sandbox** (`PAYMENT_PROVIDER=sandbox`, padrão; **recusado com `NODE_ENV=production`**); nenhum provedor real foi contratado. Para ligar um real: implementar a interface, registrar em `createPaymentProvider` e apontar o webhook do provedor para `PaymentsService.confirmPix(providerRef)`.

Estados: `PENDENTE → PAGO → ESTORNADO`, ou `PENDENTE → EXPIRADO` (`shared/payment.ts`).

| Situação                                    | O que acontece                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cartão aprovado                             | `PAGO` na criação; vai ao despacho.                                                            |
| Pix criado                                  | `PENDENTE` (15 min). **Não** entra no despacho. Ao pagar → `PAGO` e despacha.                  |
| Pix vence                                   | `EXPIRADO`; o pedido é cancelado com `PAGAMENTO_NAO_CONFIRMADO` (rotina periódica).            |
| Cliente cancela antes de pagar o Pix        | `EXPIRADO` (o código deixa de valer).                                                          |
| Pedido `CANCELADO` e pago (qualquer motivo) | **Estorno total automático** → `ESTORNADO`. Se o provedor falhar, a rotina repete a cada tick. |
| Cobrou, mas não conseguiu gravar o pedido   | Estorna na hora (`undoCharge`); se também falhar, log `ESTORNO MANUAL NECESSÁRIO`.             |
| Pedido `ENTREGUE`                           | **Sem estorno automático.** Ver `POST /admin/deliveries/:id/refund` e pendências.              |

A janela de busca por motorista (`maxSearchSeconds`) conta do **pagamento**, não da criação: quem paga o Pix no minuto 10 não perde a busca.

### Rotas do cliente (`PASSAGEIRO`/`COMERCIANTE`)

| Rota                                             | Descrição                                                                                                                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /payments/config`                           | `{ provider, sandbox, methods }`. O app usa `sandbox` para mostrar os avisos e botões de teste.                                                                                                                            |
| `POST /payments/sandbox/card-tokens`             | **Só sandbox** (`404` com provedor real). `{ number, expMonth, expYear, cvv }` → `{ token, brand, last4 }`. Faz o papel do SDK do provedor no app; confere Luhn, validade e CVV (`400`). Não guarda nem registra o número. |
| `POST /payments/sandbox/pix/:deliveryId/confirm` | **Só sandbox.** Simula o aviso "Pix pago" do provedor. Só o dono do pedido. Idempotente. `409` se o Pix já venceu.                                                                                                         |
| `POST /deliveries/:id/rating`                    | `{ stars: 1..5, comment?: ≤280 }` → 201 com o pedido. Só o **cliente dono**, só `ENTREGUE`, **uma vez** (`409`). O banco também confere 1–5.                                                                               |
| `GET /deliveries/:id/receipt`                    | Recibo. Só cliente dono ou admin (`404` para os outros, inclusive o motorista). `409` até o pagamento ser confirmado.                                                                                                      |

**Cartões de teste (sandbox):** qualquer número válido (Luhn) é aprovado; `4000 0000 0000 0002` → recusado ("Cartão recusado pelo banco"); `4000 0000 0000 9995` → "Saldo insuficiente"; `4000 0000 0000 0119` → provedor indisponível (`503`). Token no formato `sbx_<resultado>_<final>_<bandeira>` (ex.: `sbx_ok_4242_visa`). Pix de teste: código `PIX-SIMULADO|…`, só vira pago pela rota de confirmação acima.

Recibo:

```json
{
  "number": "AMMA-20261029-1A2B3C4D",
  "deliveryId": "…",
  "status": "ENTREGUE",
  "createdAt": "…",
  "deliveredAt": "…",
  "pickupAddress": "…",
  "dropoffAddress": "…",
  "distanceMeters": 2894,
  "durationSeconds": 417,
  "fareCents": 1100,
  "minimumApplied": true,
  "pricingVersion": "…",
  "payment": {
    "method": "CARTAO",
    "status": "PAGO",
    "amountCents": 1100,
    "cardBrand": "visa",
    "cardLast4": "4242",
    "paidAt": "…",
    "refundedAt": null
  },
  "paidCents": 1100,
  "refundedCents": 0,
  "notice": "Comprovante de pagamento da entrega. Não é nota fiscal; …"
}
```

O número é derivado do pedido (dia no fuso de João Pessoa + início do id). Estornado: `paidCents: 0` e `refundedCents` com o valor. **O recibo não é nota fiscal** e não traz telefone nem dados do motorista.

### Comerciante (`COMERCIANTE`)

Os pedidos usam as mesmas rotas do cliente (`POST /deliveries` etc.); o histórico é `GET /deliveries`.

| Rota                                  | Descrição                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /merchant`                       | O estabelecimento `{ tradeName, cnpj, address, lat, lng }`, ou `null` se ainda não cadastrou.                                                                                                                                                                                                      |
| `PUT /merchant`                       | Cria/atualiza. `tradeName` 2–80, `address` 5–200, `lat`/`lng`, `cnpj` opcional (com ou sem máscara; guardado só com dígitos). `400` CNPJ inválido, `409` CNPJ de outro estabelecimento.                                                                                                            |
| `GET /merchant/report?days=7\|30\|90` | Relatório (padrão 30): `total`, `delivered`, `cancelled`, `inProgress`, `spentCents`, `refundedCents`, `averageTicketCents`, `cancelRatePercent`, `perDay[{date,deliveries,spentCents}]`. Dia = fuso de João Pessoa. **Gasto = só o pago e não devolvido** (Pix pendente e estornados ficam fora). |

### Administrador

`POST /admin/deliveries/:id/refund` `{ reason }` (5–280) → 200 `{ status, refundedAt }`. Repete o estorno de um pedido **cancelado** cujo estorno automático falhou. `409` se o pedido está em andamento, já estornado ou **já entregue**: devolver o dinheiro de uma entrega concluída exigiria reverter o repasse do motorista no ledger, e a regra de disputa ainda não foi definida.

### Migração

`20261030120000_payments_merchant_rating`: `Payment`, `Merchant`, `Rating`, `Delivery.idempotencyKey` (único por cliente), valor `PAGAMENTO_NAO_CONFIRMADO` em `CancelReason`, e `CHECK` no banco (`Rating.stars` 1–5; `Payment.amountCents > 0`).

## 13. Corridas de passageiro, segurança e regras municipais (Etapa 7)

Corrida e entrega são **o mesmo pedido** (`Delivery`) com `kind: "ENTREGA" | "CORRIDA"`. Estados, oferta, aceite, pagamento, estorno, cancelamento, avaliação, recibo e ledger são os das seções 1–12; abaixo só o que muda. Na corrida: **coleta = embarque, entrega = destino**, `COLETADO` = "passageiro a bordo" (exige o PIN), `A_CAMINHO_ENTREGA` = "em viagem", `ENTREGUE` = "viagem concluída".

### 13.1 Passageiro (`PASSAGEIRO`) — `/rides`

| Rota                                                          | Descrição                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /rides/rules`                                            | O que pode ser escolhido hoje, vindo da configuração municipal: `{ city, womenDriverOptionEnabled, vehicleTypes: [{ type, label, enabled, notices }] }`.                                                                                                                                                                                                                                                                                                                                  |
| `POST /rides/quote`                                           | `{ pickup, dropoff, womenDriverOnly? }` (cada ponto `{ lat, lng, address }`). Devolve `{ distanceMeters, durationSeconds, womenDriverOnly, options: [{ vehicleType, label, available, fareCents, minimumApplied, pricingVersion, driversNearby, pickupEtaSeconds, notices }] }`. Só os tipos **liberados**. `available: false` = sem tabela de preço do tipo. `pickupEtaSeconds` = quanto o motorista elegível mais próximo leva para chegar (`null` = ninguém). Não cria nem cobra nada. |
| `POST /rides`                                                 | `{ pickup, dropoff, vehicleType: "CARRO"\|"MOTO", womenDriverOnly?, payment, idempotencyKey?, expectedFareCents? }`. Mesmo pagamento/idempotência/`expectedFareCents` da seção 12. `409` se o tipo não está liberado ou a opção "motorista mulher" está desligada; `503` se não há tabela de preço do tipo. Resposta = visão do pedido (6) com `boardingPin`.                                                                                                                             |
| `GET /rides?limit=`                                           | Suas corridas (`GET /deliveries` passa a listar **só entregas**; `?kind=CORRIDA` também funciona).                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /deliveries/:id`, `/cancel`, `/rating`, `/receipt`       | Servem às corridas com o mesmo id. Cancelar: `CLIENTE_DESISTIU` até `A_CAMINHO_COLETA` (antes de embarcar), com **estorno total**; `COLETA_IMPOSSIVEL` (motorista: passageiro não apareceu) e `ENTREGA_IMPOSSIVEL` (motorista encerrou a viagem) como nas entregas.                                                                                                                                                                                                                       |
| `GET /rides/:id/driver-photo`                                 | Foto aprovada do motorista (imagem), **só para o passageiro e só durante a corrida**. `Cache-Control: private, no-store`. `404` caso contrário.                                                                                                                                                                                                                                                                                                                                           |
| `POST /rides/:id/shares`                                      | `{ contactLabel? }` → `201 { id, token, url, contactLabel, createdAt }`. Gera o link de acompanhamento (o `token` só aparece aqui; guardamos o hash). Só corrida **em andamento com motorista**; no máximo 5 links ativos por corrida.                                                                                                                                                                                                                                                    |
| `GET /rides/:id/shares` / `DELETE /rides/:id/shares/:shareId` | Lista (sem token) / revoga (`204`). Só o dono.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /rides/:id/record`                                       | Registro da viagem do próprio passageiro: `{ events (só mudanças de estado), points: [{ lat, lng, at }], retentionDays, notice }`.                                                                                                                                                                                                                                                                                                                                                        |

Na visão do pedido (seção 6), corridas trazem: `kind`, `vehicleType`, `womenDriverOnly`, `boardingPin` (**só o passageiro**, só até embarcar), `vehicle { type, plate, model, year }` e `driverRating { average, count }` (passageiro/admin; nunca o motorista), e para o **motorista** `passenger { firstName, rating }`. A oferta (`offer.created`, `GET /driver/offers/current`) traz `kind`, `vehicleType`, `womenDriverOnly` e `passenger`.

### 13.2 Link público do contato — `/share/:token` (sem login)

| Rota                     | Descrição                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /share/:token`      | Página HTML simples (atualiza a cada 10 s). Cabeçalhos: `no-store`, `no-referrer`, `noindex`, CSP restritiva.                                                                                                                                                                                                      |
| `GET /share/:token/data` | `{ status, statusText, ended, passenger, driver, vehicle { type, plate, model }, pickup, dropoff, driverPosition, emergency, updatedAt }`. **Lista fechada** (testada): só primeiros nomes; nunca telefone, id, valor, pagamento ou PIN. `404` para token inexistente/revogado/depois de 30 min do fim da corrida. |

O app não envia nada ao contato: entrega o link ao compartilhamento do sistema (WhatsApp, SMS…), como no Pix. O token tem 192 bits; só o SHA-256 fica no banco.

### 13.3 Motorista (`MOTORISTA`)

| Rota                                    | Descrição                                                                                                                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /driver/deliveries/:id/picked-up` | Corrida: corpo `{ pin }` (4 dígitos) **obrigatório**. PIN errado/ausente → `403`; depois de 5 tentativas o embarque trava (`409`; o passageiro ainda pode cancelar). O contador sobe antes da comparação, de forma atômica. Entrega ignora o corpo. |
| `POST /driver/deliveries/:id/rating`    | `{ stars, comment? }` — o motorista avalia o passageiro. Só corrida `ENTREGUE`, uma vez. `409` em entrega comum.                                                                                                                                    |
| `GET /driver/ride-eligibility`          | Por veículo: `{ eligible, problems[], documentsToSend[] }` pelas regras municipais vigentes, mais `rulesVersion`, `rulesAreDefault`, `warning`, `gender`, `womenDriverVerified`.                                                                    |
| `PUT /driver/gender`                    | `{ gender: "FEMININO"\|"MASCULINO"\|"NAO_INFORMADO" }` → `{ gender, verified }`. Autodeclaração; mudar o valor zera a verificação. `409` sem perfil. (`PUT /driver/profile` também aceita `gender`.)                                                |
| `POST /driver/documents`                | Passou a aceitar também `ANTECEDENTES`, `LICENCA_MUNICIPAL` e `SEGURO_PASSAGEIROS` (só contam se as regras municipais os exigirem; **não** entram na aprovação geral de entregas).                                                                  |
| `POST /driver/offers/:id/accept`        | Em corrida, reconfere as regras no instante do aceite (`409` se o veículo deixou de atender) e grava o veículo que atende (`vehicleId`).                                                                                                            |

### 13.4 Emergência e denúncia (qualquer usuário logado) — `/safety`

| Rota                     | Descrição                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /safety/emergency` | `{ deliveryId?, lat?, lng?, note? }` → `200 { id, status, createdAt }`. Com `deliveryId`, só participante (`404` caso contrário). Registra o alerta e envia `safety.emergency` por WebSocket a todos os administradores. Apertar de novo em 120 s atualiza o mesmo alerta. O link do contato passa a mostrar o aviso.       |
| `POST /safety/reports`   | `{ deliveryId?, category, description }` (`category` ∈ `ASSEDIO, VIOLENCIA, DISCRIMINACAO, DIRECAO_PERIGOSA, MOTORISTA_DIFERENTE, VEICULO_DIFERENTE, COBRANCA_INDEVIDA, OUTRO`; descrição 10–1000). O denunciado é **sempre a outra parte da corrida** — o corpo não aceita id de usuário (`400`). Máx. 10 por dia (`409`). |
| `GET /safety/reports`    | Suas denúncias: `{ id, deliveryId, category, status, resolution, … }`. Nunca dados do denunciado.                                                                                                                                                                                                                           |

### 13.5 Administrador (`ADMIN`)

| Rota                                          | Descrição                                                                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/safety/alerts?status=`            | Alertas de emergência (com nome/telefone de quem acionou). `PATCH /admin/safety/alerts/:id` `{ status: ABERTO\|EM_ATENDIMENTO\|ENCERRADO, note? }`.                                                                                                 |
| `GET /admin/safety/reports?status=`           | Fila de denúncias, **graves primeiro** (`severe`), com denunciante e denunciado. `PATCH /admin/safety/reports/:id` `{ status: ABERTA\|EM_ANALISE\|PROCEDENTE\|IMPROCEDENTE\|ARQUIVADA, resolution? }` — a `resolution` aparece para quem denunciou. |
| `GET /admin/rides/:id/trip-record`            | Registro completo da viagem: todos os eventos (inclui as decisões do despacho), trajeto, alertas, denúncias, quantos links foram criados e o **log de quem já abriu o registro**. Cada chamada grava um acesso (`TripRecordAccess`).                |
| `POST /admin/drivers/:id/gender-verification` | `{ verified }`. Só verifica quem se declarou `FEMININO` (`400`). É isso que habilita a opção "motorista mulher" para o motorista.                                                                                                                   |
| `GET /admin/municipal-rules` / `/current`     | Histórico de versões / a vigente (`{ version, rules, isDefault, legalReference, warning }`).                                                                                                                                                        |
| `POST /admin/municipal-rules`                 | `{ version, effectiveFrom, rules, legalReference? }`. Valida (`400` com `problems[]`), exige `effectiveFrom` posterior à última versão (`409`). Versões antigas nunca são editadas.                                                                 |
| `POST /admin/pricing`                         | Ganhou `profile` opcional: `ENTREGA` (padrão), `CORRIDA_CARRO` ou `CORRIDA_MOTO`. Cada perfil tem a sua linha do tempo (a regra "só vigência posterior" vale dentro do perfil). `GET` lista todos com `profile`.                                    |

### 13.6 Regras municipais (`rules`)

```json
{
  "city": "João Pessoa - PB",
  "womenDriverOptionEnabled": true,
  "car": {
    "enabled": true,
    "maxVehicleAgeYears": 10,
    "minDriverAgeYears": 21,
    "requiredDocuments": ["CNH", "DOCUMENTO_VEICULO", "FOTO"],
    "passengerNotices": []
  },
  "moto": {
    "enabled": false,
    "maxVehicleAgeYears": 8,
    "minDriverAgeYears": 21,
    "requiredDocuments": ["CNH", "DOCUMENTO_VEICULO", "FOTO"],
    "passengerNotices": ["…"]
  }
}
```

- `requiredDocuments` precisa incluir `CNH`, `DOCUMENTO_VEICULO` e `FOTO`; pode somar `ANTECEDENTES`, `LICENCA_MUNICIPAL`, `SEGURO_PASSAGEIROS`.
- Idade do veículo = ano atual − ano de fabricação, **inclusiva** (limite 10 aceita 10). Idade do motorista em anos completos.
- **Sem versão publicada vale o padrão do código, marcado como NÃO confirmado** (carro liberado, mototáxi desligado). Os números do padrão são exemplos, **não** a lei de João Pessoa.
- As regras são aplicadas no **despacho** (quem recebe a oferta), no **aceite** e na **estimativa** (`driversNearby`).

### 13.7 Despacho de corridas

Mesmas regras da seção 2, com dois filtros novos, ambos registrados no `excluded` da decisão:

- `VEICULO_INELEGIVEL` — o motorista não tem veículo do tipo pedido que cumpra as regras municipais vigentes;
- `FORA_DA_PREFERENCIA` — o passageiro pediu motorista mulher e o motorista não é mulher **verificada** (autodeclarada + conferida pela associação).

Sem nenhum elegível o pedido segue em `CRIADO` até a janela de busca acabar (`SEM_MOTORISTA`, com estorno) — **nunca** cai para outro motorista. Entregas não sofrem nenhum dos dois filtros.

### 13.8 Variáveis e migração

`PUBLIC_BASE_URL` (padrão `http://localhost:3000`): base dos links de compartilhamento. Migração `20261031120000_rides_safety_municipal`: `DeliveryKind`, campos de corrida em `Delivery` (+ `CHECK`: corrida sempre tem tipo de veículo e PIN de 4 dígitos), `Rating` mútua (`driverId` → `rateeId`, `direction`, única por pedido+direção), `PricingConfigVersion.profile`, `DriverProfile.gender*`, novos tipos de documento e as tabelas `TripShare`, `EmergencyAlert`, `Report`, `TripPoint`, `TripRecordAccess`, `MunicipalRulesVersion`.
