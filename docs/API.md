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

## 14. Associação (Etapa 8)

Todas as rotas `/association`, `/assembly`, `/purchase-groups` e `/insurance` são de `MOTORISTA`; as `/admin/...` são de `ADMIN`. **Sócio = quem tem ao menos 1 cota no ledger** (o que `GET /association/me` chama de `isMember`). Erros em português, no mesmo formato das outras seções.

### 14.1 Resumo do sócio

- `GET /association/me` → `{ associationRate, rateOptions: [0,2,4], quotaValueCents: 500, quotas, remainderCents, isMember, minQuotasToBeMember, progress: { level, nextLevel, quotasToNext, centsToNext, percent }, history: [{ at, kind, cents }] }`. `percent` é quanto da faixa do nível atual já foi percorrido (Ouro = 100). `history` são os últimos lançamentos da conta de cotas.
- A taxa continua sendo escolhida em `PUT /driver/association-rate { rate: 0|2|4 }` (seção 4) e vale para as **próximas** corridas.
- `GET /association/surplus` → sobras que o sócio recebeu, por ano.

### 14.2 Assembleia

| Rota                                   | Quem  | O que faz                                                                                                                                                                      |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /admin/assembly/proposals`       | admin | Cria e **abre agora** uma proposta: `{ kind: GERAL \| REGRA_COMPRA_COLETIVA, title, description, closesAt, quorumPercent?, ruleChange? }`. Prazo: de 24 h a 60 dias.           |
| `GET /assembly/proposals?filter=`      | sócio | Lista (`abertas` ou `encerradas`). Fecha antes as que venceram.                                                                                                                |
| `GET /assembly/proposals/:id`          | sócio | Proposta, **o seu voto** e, só depois de encerrada, o `result` (`yes`, `no`, `abstain`, `total`, `ballotDigest`, `appliedRulesVersion`).                                       |
| `PUT /assembly/proposals/:id/vote`     | sócio | `{ choice: SIM \| NAO \| ABSTENCAO }`. Vota ou **muda o voto** até o fechamento. `403` se não for sócio; `409` se a votação já encerrou. Repetir a mesma escolha não faz nada. |
| `GET /assembly/proposals/:id/my-votes` | sócio | O histórico **do próprio sócio** (voto e mudanças). Nunca o de outros.                                                                                                         |

- **Resultado:** `APROVADA` (mais SIM que NÃO), `REJEITADA` (empate inclusive) ou `SEM_QUORUM` (menos votos que `quorumPercent` dos sócios aptos na abertura, mínimo 1). Abstenção conta para o quórum, não para a maioria.
- **Sigilo:** a contagem só aparece depois do fechamento; o voto de cada sócio nunca é mostrado a outros.
- **Regra da compra coletiva:** `ruleChange` é um objeto parcial, ex. `{ "minQuotas": 5, "dayWeight": 3 }` (chaves: `quotaWeight`, `dayWeight`, `minQuotas`, `minContributionCents`; inteiros, limites validados; os dois pesos não podem ser zero). Se a proposta for **aprovada**, nasce uma nova versão das regras (`appliedRulesVersion`).
- **Fechamento:** feito uma única vez, por rotina (`ASSOCIATION_TICK_MS`, padrão 30 s) ou ao ler a proposta vencida. Depois disso o banco recusa qualquer alteração na proposta, nos votos e no histórico.
- `GET /admin/assembly/proposals`: mesma lista, para o admin. `GET /admin/purchase-rules`: histórico das versões das regras da compra coletiva.

### 14.3 Compra coletiva

| Rota                                       | Quem  | O que faz                                                                                                                                                                           |
| ------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/purchase-groups`              | admin | `{ name, description?, vehicleType: MOTO \| CARRO, targetCents }` (`targetCents` = preço de **um** veículo).                                                                        |
| `POST /admin/purchase-groups/:id/award`    | admin | Contempla o **primeiro da fila**, se os aportes confirmados cobrem mais um veículo (`409` se não). Trava o grupo: contemplações simultâneas não gastam o mesmo dinheiro duas vezes. |
| `POST /admin/purchase-groups/:id/close`    | admin | Encerra o grupo (sem novas entradas nem aportes).                                                                                                                                   |
| `GET /purchase-groups`                     | sócio | Grupos com `fundedCents`, `queueSize` e a sua situação (`myStatus`).                                                                                                                |
| `GET /purchase-groups/:id`                 | sócio | Detalhe: regras em vigor, `availableUnits`, **fila** (posição, primeiro nome, cotas, pontos, dias; `isMe`) e contemplações.                                                         |
| `POST /purchase-groups/:id/join` / `leave` | sócio | Entra (exige o mínimo de cotas da regra) ou sai. Quem **tem aportes** não sai sozinho (`409`). Quem sai e volta recomeça o tempo de fila.                                           |
| `POST /purchase-groups/:id/contributions`  | sócio | `{ amountCents, idempotencyKey? }`. Pede ao parceiro; só se ele aceitar vira registro **e** lançamento no ledger, juntos. Mesma chave = mesmo aporte.                               |
| `GET /purchase-groups/:id/contributions`   | sócio | Os aportes do sócio e o total (do ledger).                                                                                                                                          |

- **Fila:** pontos = `cotas × quotaWeight + dias de fila × dayWeight` (padrão 10 e 1; mínimo 1 cota; aporte mínimo R$ 50,00 — **exemplos**, a assembleia decide). Empate: quem entrou antes; depois, o id (ordem estável).
- **Parceiro simulado** (`PURCHASE_PARTNER=sandbox`, recusado em produção): aceita; **R$ 13,13** → parceiro fora do ar (`503`, nada é gravado); acima de **R$ 10.000,00** → `RECUSADO` (fica registrado, sem ledger). **Nenhum dinheiro se move.** Não existe parceiro real: trocar = implementar `PurchasePartner` (`association/partner.ts`).

### 14.4 Seguro mútuo

| Rota                                                  | Quem  | O que faz                                                                                                                                               |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /insurance/claims`                              | sócio | `{ kind: ACIDENTE \| ROUBO_FURTO \| DANOS_VEICULO \| OUTRO, occurredAt, description, requestedCents }`. Nasce `ENVIADA`. Data não pode ser futura.      |
| `GET /insurance/claims` / `:id`                       | sócio | Os pedidos do próprio sócio, com anexos e **linha do tempo**.                                                                                           |
| `POST /insurance/claims/:id/attachments`              | sócio | Multipart `file` (JPG, PNG ou PDF, até 5 MB, tipo conferido pelo conteúdo, máx. 8). Só até a decisão.                                                   |
| `GET /insurance/claims/:id/attachments/:attachmentId` | sócio | Baixa o anexo (só o dono). Admin: `GET /admin/insurance/claims/:id/attachments/:attachmentId`.                                                          |
| `POST /insurance/claims/:id/cancel`                   | sócio | Cancela até a decisão.                                                                                                                                  |
| `GET /admin/insurance/claims?status=` / `:id`         | admin | Fila de pedidos (mais antigos primeiro) com quem pediu.                                                                                                 |
| `POST /admin/insurance/claims/:id/review`             | admin | `ENVIADA → EM_ANALISE`.                                                                                                                                 |
| `POST /admin/insurance/claims/:id/decision`           | admin | `{ decision: APROVADA \| NEGADA, note, approvedCents? }`. **Motivo obrigatório**; aprovar exige valor entre 1 centavo e o pedido; negar não leva valor. |

- Fluxo: `ENVIADA → EM_ANALISE → APROVADA \| NEGADA`; `CANCELADA` até a decisão. Não pula a análise, e decidido/cancelado é final.
- **Decisão humana:** a API só registra o que um admin decidiu; nada é aprovado ou negado sozinho. **Quem pediu não analisa nem decide o próprio pedido**, mesmo sendo admin (`403`).
- **Não há pagamento do seguro:** `APROVADA` só registra o valor aprovado. O pagamento e o fundo do seguro dependem de decisões da associação (ver PROGRESSO).

### 14.5 Sobras anuais (`ADMIN`)

- `POST /admin/surplus/simulate { year, distributableCents, useWeightPercent? }` → **não grava nada**. Devolve `shares` (por sócio: `quotas`, `useCents`, `amountCents`), `totals`, `yearOver`, `alreadyClosed` e um `checksum`.
- `POST /admin/surplus/close { year, distributableCents, useWeightPercent?, checksum }` → só **depois do fim do ano** (fuso de João Pessoa) e **uma vez por ano**. Recalcula; se o resultado não bater com o `checksum` da simulação (dados mudaram ou valores diferentes), responde `409` mandando simular de novo. Grava o fechamento, as partes e o lançamento `SURPLUS_DISTRIBUTION` no ledger (credita o saldo `WORKER_BALANCE` de cada sócio), tudo numa transação.
- `GET /admin/surplus/runs` → anos fechados.
- Regras de cálculo: `docs/REGRAS_FINANCEIRAS.md`, seção 8.

### 14.6 Variáveis e migração

`PURCHASE_PARTNER` (padrão `sandbox`) e `ASSOCIATION_TICK_MS` (padrão `30000`; `0` desliga a rotina — usado nos testes). Migração `20261101120000_associacao`: tabelas de assembleia (`Proposal`, `Vote`, `VoteRecord`, `PurchaseRulesVersion`), compra coletiva (`PurchaseGroup`, `QueueEntry`, `Contribution`, `GroupAward`), seguro (`InsuranceClaim`, `InsuranceAttachment`, `InsuranceEvent`), sobras (`SurplusRun`, `SurplusShare`) e os tipos de ledger `GROUP_CONTRIBUTION` e `SURPLUS_DISTRIBUTION`. O banco **recusa** apagar/alterar: histórico de votos, versões de regras, contemplações, linha do tempo do seguro e sobras; proposta encerrada; voto de proposta encerrada.

## 15. Pontos de acolhida (Etapa 9)

Rotas `/welcome-points/...` valem para qualquer pessoa logada, salvo as marcadas; `/admin/welcome-...` são de `ADMIN`. Erros no mesmo formato das outras seções. Tipos: `ESPACO_PUBLICO`, `CASA_PARCEIRA`, `COMERCIO`. Comodidades: `AGUA`, `BANHEIRO`, `CARREGADOR`, `DESCANSO`, `WIFI`, `ALIMENTACAO`, `ESTACIONAMENTO`. Status: `EM_ANALISE`, `ATIVO`, `SUSPENSO`, `RECUSADO`, `REMOVIDO`.

### 15.1 Cadastro

| Rota                              | Quem  | O que faz                                                                                                                                                                                                                                                        |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /welcome-points/rules`       | todos | Tipos, comodidades, capacidade máxima e número máximo de fotos.                                                                                                                                                                                                  |
| `POST /welcome-points`            | todos | `{ type, name, address, neighborhood, reference?, description?, lat, lng, hours, amenities[], capacity (1–50), benefitKind?, checklist? }`. `COMERCIO` e `ESPACO_PUBLICO` nascem `ATIVO`; `CASA_PARCEIRA` nasce `EM_ANALISE` e **exige o `checklist` completo**. |
| `PATCH /welcome-points/:id`       | dono  | Só `name`, `description`, `reference`, `hours`, `amenities`, `capacity`, `benefitKind`. Endereço, posição e tipo exigem novo cadastro (`400` se enviados).                                                                                                       |
| `DELETE /welcome-points/:id`      | dono  | Remove o ponto (`REMOVIDO`), apaga as fotos e libera quem estava lá. `204`.                                                                                                                                                                                      |
| `GET /welcome-points/mine`        | todos | Os seus pontos (menos removidos), com status, motivo, checklist e benefício.                                                                                                                                                                                     |
| `POST /welcome-points/:id/photos` | dono  | Multipart `file` (JPG ou PNG, até 5 MB, tipo conferido pelo conteúdo, máx. 6). `GET .../photos/:photoId` baixa (qualquer logado se o ponto está `ATIVO`; dono e admin sempre); `DELETE .../photos/:photoId` apaga (dono).                                        |

- `hours` = `{ "always": true, "slots": [] }` (24 h) ou `{ "always": false, "slots": [{ "days": [1,2,3,4,5], "open": "08:00", "close": "18:00" }] }` (`days` 0 = domingo … 6 = sábado, horário de João Pessoa; `close` menor que `open` vira a noite; até 14 faixas).
- `checklist` (só casa parceira; rejeitado nos outros tipos): `{ RESPONSAVEL_MAIOR, AREA_SEPARADA, BANHEIRO_ACESSIVEL, ENTRADA_ILUMINADA, SEM_COBRANCA, CODIGO_DE_CONDUTA }`, todos `true`. O texto de cada item está em `shared/welcome-point.ts` (`HOUSE_CHECKLIST`).
- Limites: 3 cadastros por 24 h, 10 pontos vivos por pessoa, e `409` se já existe ponto do mesmo tipo a menos de 30 m.

### 15.2 Mapa

- `GET /welcome-points?lat=&lng=&radiusMeters=&types=&amenities=&openNow=&minRating=` → pontos `ATIVO` ao redor, **do mais perto**, no máximo 100. `lat` e `lng` são obrigatórios; `radiusMeters` de 100 a 30000 (padrão 5000); `types` e `amenities` separados por vírgula (a comodidade exige **todas**); `openNow=true`; `minRating` de 1 a 5 (ponto sem média ainda passa).
- `GET /welcome-points/:id?lat=&lng=` → o ponto (com `distanceMeters` se mandar a posição). Ponto que não está `ATIVO` só o dono e o admin enxergam (`404` para os outros).
- **Visão do ponto:** `{ id, type, name, description, neighborhood, address, reference, lat, lng, approximate, hours, openNow, amenities, capacity, occupied, photos[], rating: { average, count }, hasHost, isOwner, distanceMeters? }` e, **só para o dono e o admin**, `status`, `statusNote`, `benefitKind`, `checklist`.
- **Casa parceira:** `address` e `reference` vêm `null` e `lat`/`lng` vêm **arredondados (~110 m)** com `approximate: true`, exceto para o dono, o admin e quem está com check-in aberto lá.
- **Nota:** `average` só aparece com 3 ou mais avaliações (arredondada para baixo). Comentários nunca aparecem para ninguém, só para o admin.

### 15.3 Check-in e avaliação dos dois lados

| Rota                                                     | Quem        | O que faz                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /welcome-points/:id/check-in`                      | `MOTORISTA` | `{ lat, lng }` do aparelho. `201 { checkIn, point }` (com o endereço completo). `409` se: a mais de 200 m, ponto fechado, lotado, já há check-in aberto, ou visita ao mesmo ponto há menos de 6 h. `403` para o anfitrião. |
| `GET /welcome-points/check-ins/active`                   | `MOTORISTA` | `{ checkIn, point }` ou `{ checkIn: null, point: null }`. Fecha antes os que passaram de 4 h.                                                                                                                              |
| `POST /welcome-points/check-ins/:checkInId/end`          | `MOTORISTA` | Sai do ponto. Com **5 min ou mais** a visita conta (`completed`, `canRate`) e, na casa parceira, gera o benefício. `409` se já encerrado.                                                                                  |
| `GET /welcome-points/check-ins/mine`                     | `MOTORISTA` | Últimas 30 visitas encerradas, com `rated` e `canRate`.                                                                                                                                                                    |
| `POST /welcome-points/check-ins/:checkInId/rate`         | `MOTORISTA` | `{ stars: 1–5, comment? }` — avalia o **ponto**. Só visita que contou, até 7 dias depois, uma vez (`409`).                                                                                                                 |
| `POST /welcome-points/check-ins/:checkInId/rate-visitor` | anfitrião   | Mesmo corpo — o anfitrião avalia o **visitante**. `403` em espaço público (sem anfitrião); `404` se o ponto não é seu.                                                                                                     |
| `GET /welcome-points/:id/visits`                         | dono        | Visitas que contaram nos últimos 30 dias: `{ id, endedAt, minutes, visitorName (só o primeiro nome), visitorRating, rated, canRate }`.                                                                                     |

- A **posição do aparelho não é guardada**; só a distância no momento do check-in.
- O check-in aberto fecha sozinho depois de 4 h, **sem benefício** e sem contar como visita.

### 15.4 Benefício do anfitrião

- Só **casa parceira**, quando a visita conta: **R$ 1,00 por visita**, no máximo **R$ 30,00 por ponto por mês** (mês de João Pessoa); o que passar do teto rende 0. Valores de exemplo (`shared/welcome-point.ts`).
- `benefitKind` (escolha do anfitrião, `PATCH`): `CREDITO` → lançamento no saldo do anfitrião; `DESCONTO` → desconto acumulado para abater taxas. Ver `docs/REGRAS_FINANCEIRAS.md`, seção 9.

### 15.5 Denúncia e remoção

| Rota                               | Quem  | O que faz                                                                                                                                                                                                              |
| ---------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /welcome-points/:id/reports` | todos | `{ category: SEGURANCA \| ASSEDIO \| COBRANCA_INDEVIDA \| LOCAL_INEXISTENTE \| ESTRUTURA_DIFERENTE \| OUTRO, text? (até 1000) }`. `409` se já há uma aberta sua nesse ponto ou passou de 5 no dia; `403` no seu ponto. |
| `GET /welcome-points/reports/mine` | todos | Suas denúncias com a situação (`ABERTA`, `PROCEDENTE`, `IMPROCEDENTE`) e a resposta da associação. Nunca o texto de outras pessoas.                                                                                    |

**Suspensão automática** (o ponto sai do mapa, quem estava lá é liberado e fica `SUSPENSO` com o motivo em `statusNote`): uma denúncia **grave** (`SEGURANCA`, `ASSEDIO`); **3 pessoas diferentes** com denúncia aberta; ou **média abaixo de 2,0 com 5 ou mais avaliações do ponto**. Roda a cada denúncia e a cada nota. O sistema só suspende — remover é decisão do admin.

### 15.6 Administrador (`ADMIN`)

| Rota                                       | O que faz                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/welcome-points?status=`        | Fila de pontos (mais antigos primeiro), com o dono e o número de denúncias abertas.                                                                      |
| `GET /admin/welcome-points/:id`            | Tudo: endereço, checklist, dono (nome e telefone), linha do tempo, denúncias com texto e as avaliações **com comentário**.                               |
| `POST /admin/welcome-points/:id/approve`   | `{ identityChecked: true, placeChecked: true, note? }` — `EM_ANALISE → ATIVO`. Sem as duas conferências, `400`.                                          |
| `POST /admin/welcome-points/:id/refuse`    | `{ note }` — `EM_ANALISE → RECUSADO`.                                                                                                                    |
| `POST /admin/welcome-points/:id/remove`    | `{ note }` — `EM_ANALISE`, `ATIVO` ou `SUSPENSO` → `REMOVIDO`. Final.                                                                                    |
| `POST /admin/welcome-points/:id/reinstate` | `{ note }` — `SUSPENSO → ATIVO`. `409` enquanto houver denúncia aberta sobre o ponto.                                                                    |
| `GET /admin/welcome-reports?status=`       | Denúncias (padrão `ABERTA`): **graves primeiro**, depois as mais antigas; com texto, denunciante e ponto.                                                |
| `POST /admin/welcome-reports/:id/resolve`  | `{ outcome: PROCEDENTE \| IMPROCEDENTE, response, removePoint? }`. `removePoint` só com `PROCEDENTE` e remove o ponto junto. Resolve uma vez só (`409`). |

- Motivo (`note`/`response`) é **obrigatório** (mín. 5 caracteres) em recusar, remover, reativar e resolver. Quem cadastrou o ponto **não decide** sobre ele nem sobre denúncias dele (`403`). Todo passo vira linha da linha do tempo (`PointEvent`), imutável.

### 15.7 Migração e dados

Migração `20261102120000_pontos_acolhida`: `WelcomePoint`, `WelcomePointPhoto`, `CheckIn`, `PointRating`, `PointReport`, `PointEvent` e o tipo de lançamento `HOST_BENEFIT`. Garantias no banco: nota 1–5, capacidade 1–50, coordenadas válidas, **um check-in aberto por pessoa**, **uma denúncia aberta por pessoa em cada ponto** e `PointEvent` somente inserção. Não há variável de ambiente nova. O seed cria 4 pontos de exemplo (praça, padaria, casa aprovada e casa em análise).

## 16. Painel admin (Etapa 10)

Painel web em `apps/admin` (`:3001`). Papéis de painel: **`ADMIN`** (papel do usuário) e **`SOCIO`** (motorista com ao menos 1 cota, lida do ledger). Rotas `/admin/*` são só de `ADMIN` (as das etapas anteriores continuam valendo e entram na auditoria); rotas `/panel/*` abrem a `ADMIN` e `SOCIO`, somente leitura. Sem `@PanelAccess` o guard nega por padrão. Erros no formato das outras seções.

### 16.1 Leitura (ADMIN e SÓCIO)

| Rota                                                                | O que faz                                                                                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /panel/me` (qualquer logado)                                   | `{ id, name, panelRoles[] }`. Vazio = sem acesso ao painel.                                                                                                    |
| `GET /panel/assembly/proposals?filter=abertas\|encerradas` e `/:id` | As mesmas propostas do app (resultado com contagem e `ballotDigest` só depois de encerrar).                                                                    |
| `GET /panel/purchase-groups` e `/:id`                               | Grupos, valor aportado e fila (só o primeiro nome dos sócios) e contemplados.                                                                                  |
| `GET /panel/budget?year=`                                           | Orçamento aberto: `{ year, summary { revenueCents, expenseCents, balanceCents, byCategory[], byMonth[] }, entries[], note }`. `createdByName` só para `ADMIN`. |

### 16.2 Só ADMIN

| Rota                                                                                                             | O que faz                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/overview?days=1..365` (padrão 30)                                                                    | Pedidos e corridas (total, concluídos, cancelados, em andamento, taxa de conclusão), ganhos líquidos (média por trabalhador e por corrida), associação (sócios, cotas, níveis, fundo de cotas, aportes da compra coletiva, receita da taxa base), satisfação (notas 1–5 nos dois sentidos e dos pontos) e **filas** (documentos, comerciantes, pontos, denúncias, alertas, recursos, seguros). |
| `GET /admin/drivers?status=&q=`                                                                                  | Motoristas com situação geral (derivada dos documentos), faltantes, veículos e último envio de cada documento. Pendentes primeiro. Aprovar/reprovar: `POST /admin/documents/:id/review` (já existia).                                                                                                                                                                                          |
| `GET /admin/merchants?status=`                                                                                   | Comerciantes. `POST /admin/merchants/:id/review` `{ status: APROVADO\|REPROVADO, reason? }` (motivo obrigatório na recusa; não revisa o próprio cadastro).                                                                                                                                                                                                                                     |
| `GET /admin/users?q=&blocked=true\|false`                                                                        | Busca por nome/telefone (até 50).                                                                                                                                                                                                                                                                                                                                                              |
| `POST /admin/users/:id/block` `{ reason }`                                                                       | Bloqueia a conta (motivo de 10 a 1000 caracteres). Não vale contra si mesmo nem outro admin. `409` se já bloqueada. Tira o motorista do ar e ele deixa de receber ofertas.                                                                                                                                                                                                                     |
| `GET /admin/blocks?status=&userId=`                                                                              | Bloqueios (`ATIVO`, `EM_RECURSO`, `MANTIDO`, `REVOGADO`), com motivo, recurso e decisões.                                                                                                                                                                                                                                                                                                      |
| `POST /admin/blocks/:id/appeal-decision` `{ decision: ACEITO\|NEGADO, reason }`                                  | Decide o recurso. `403` se quem decide aplicou o bloqueio. Aceito → `REVOGADO` (conta liberada); negado → `MANTIDO`. `409` se não há recurso em análise.                                                                                                                                                                                                                                       |
| `POST /admin/blocks/:id/revoke` `{ reason }`                                                                     | Revoga a qualquer momento. Um novo bloqueio vira um novo registro.                                                                                                                                                                                                                                                                                                                             |
| `GET /admin/audit?actorId=&action=&from=&to=&limit=&before=`                                                     | Trilha de auditoria, do mais recente; `nextCursor` para a próxima página. `GET /admin/audit/actions` lista as ações já registradas.                                                                                                                                                                                                                                                            |
| `POST /admin/budget/entries` `{ kind, category, description, amountCents, occurredOn: YYYY-MM-DD, receiptRef? }` | Lança receita (`OUTRA_RECEITA`, `DOACAO`, `PARCERIA`) ou despesa (`INFRAESTRUTURA`, `PESSOAL`, `JURIDICO`, `CONTABILIDADE`, `SEGURO`, `MARKETING`, `OUTRA_DESPESA`). Data não pode ser futura.                                                                                                                                                                                                 |
| `POST /admin/budget/entries/:id/reverse` `{ reason }`                                                            | Estorna (novo lançamento ligado ao original). Um estorno por lançamento; estorno não se estorna.                                                                                                                                                                                                                                                                                               |

### 16.3 Da própria pessoa bloqueada (`@AllowBlocked`)

Conta bloqueada recebe `403 { code: "ACCOUNT_BLOCKED" }` em qualquer rota, **exceto**: `GET /me`, `DELETE /me` (LGPD) e as duas abaixo. O WebSocket recusa a conexão.

| Rota                               | O que faz                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/block`                    | `{ blocked, status, reason, blockedAt, appealDeadline, canAppeal, cannotAppealReason, appealText, decisionReason, ... }` (`{ blocked: false }` se nunca foi bloqueada). |
| `POST /me/block/appeal` `{ text }` | Recurso (10 a 2000 caracteres), **uma vez** por bloqueio e em até 30 dias. `409` se já enviado ou fora do prazo.                                                        |

### 16.4 Auditoria

O `AuditInterceptor` registra **toda** chamada bem-sucedida de escrita em qualquer `/admin/*` (inclusive rotas futuras) e a leitura de dado sensível (arquivo de documento, anexo de seguro, registro de viagem). Guarda: quem, ação (`POST /admin/users/:id/block`), ids da rota, motivo (`reason`/`note`/`response`/`decisionReason`/`resolution`, se enviado) e IP; **não** o corpo da requisição. A gravação acontece antes da resposta. A tabela é somente inserção (o banco recusa editar/apagar). Ação que falha não entra.

### 16.5 Painel (Next.js)

O navegador só fala com o painel: `POST /api/auth/request` e `/api/auth/verify` (OTP → cookies `httpOnly`, `SameSite=Strict`, só para quem tem papel de painel), `POST /api/auth/logout` e `/api/proxy/<admin|panel>/...` (repassa com o token; escritas exigem `Origin` igual ao host). Variável: `ADMIN_API_URL`.

## Autenticação: reautenticação, sair de todos os aparelhos e limites (auditoria de segurança, Parte 1)

- `POST /auth/logout-all` (logado): revoga todos os refresh tokens da conta e a reautenticação. `204`.
- `POST /auth/reauth/request` (logado, sem corpo): envia um código por SMS ao telefone **da própria conta** (mesmos limites do OTP). Em modo simulado devolve `devCode`.
- `POST /auth/reauth/verify` `{ code }`: confirma e libera ações críticas por **10 min**.
- Ações críticas do admin (preço, despacho, estorno, bloqueio e recurso, aprovação de comerciante/documento/ponto, orçamento, regras municipais, compra coletiva, seguro, sobras, criação de assembleia, verificação de gênero) respondem `403 { code: "REAUTH_REQUIRED" }` sem reautenticação recente.
- Limites: `429` com `Retry-After`. Padrão 300 req/min por IP; `/auth/otp/*` 10/min por IP; `/auth/refresh` e `/auth/logout` 30/min; `/auth/reauth/*` 5–10 por 10 min; `/share/:token/data` 30/min; uploads 20/h por usuário. OTP: 3 códigos/10 min, 10/dia e 20 erros/hora por telefone.
- JWT: `HS256`, `iss=amma-api`, `aud=amma-app`.
- Painel: `POST /api/auth/reauth/request|verify` (repassam à API com o token do cookie).

## Conclusão exige presença no destino (auditoria de segurança, Parte 2)

`POST /driver/deliveries/:id/delivered` responde `409` quando:

- `{ code: "TOO_FAR_FROM_DROPOFF", distanceMeters, maxMeters: 300 }`: a última posição recebida pelo servidor está a mais de 300 m do destino;
- `{ code: "POSITION_UNKNOWN" }`: não há posição, ou ela tem mais de 120 s (GPS desligado, app fechado).

O app deve manter o envio de posição (`POST /driver/position` ou WebSocket). Quem não consegue chegar usa `POST /deliveries/:id/cancel` com `ENTREGA_IMPOSSIVEL`. O despacho e o aceite nunca atribuem o pedido ao próprio cliente.
