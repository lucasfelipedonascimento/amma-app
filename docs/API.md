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

| `reason`             | Quem pede | Quando                                                          |
| -------------------- | --------- | --------------------------------------------------------------- |
| `CLIENTE_DESISTIU`   | cliente   | `CRIADO`, `OFERECIDO`, `ACEITO`, `A_CAMINHO_COLETA`             |
| `COLETA_IMPOSSIVEL`  | motorista | `A_CAMINHO_COLETA`                                              |
| `ENTREGA_IMPOSSIVEL` | motorista | `COLETADO`, `A_CAMINHO_ENTREGA`                                 |
| `ADMIN_CANCELOU`     | admin     | qualquer estado não final; **exige** `note` (justificativa)     |
| `SEM_MOTORISTA`      | sistema   | `CRIADO`, quando acaba o tempo máximo de busca (não é chamável) |

Cancelamento não gera lançamento financeiro. Multas/ressarcimentos ainda **não** existem (ver pendências).

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

Cria o pedido (estado `CRIADO`), congela a cotação e **já tenta despachar**; a resposta traz o estado atual (normalmente `OFERECIDO` ou `CRIADO`). Resposta = visão do pedido (seção 6).

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
  "timeline": [{ "status": "CRIADO", "reason": null, "at": "…" }],
  "driverPosition": null
}
```

- `driver` aparece para cliente/admin (só id e nome — **nunca telefone**); o motorista recebe `null`.
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

`REDIS_URL`, `ROUTE_PROVIDER`, `MAPBOX_ACCESS_TOKEN`, `DISPATCH_TICK_MS` (ver `.env.example`).

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
