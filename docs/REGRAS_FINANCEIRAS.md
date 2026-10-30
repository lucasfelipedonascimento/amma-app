# Regras financeiras

Código em `packages/shared/src` (`pricing.ts`, `fees.ts`, `quotas.ts`, `ledger.ts`). Todos os valores são **inteiros em centavos**; nunca há `float` em dinheiro. O app **não guarda dinheiro**: o ledger é contábil e o dinheiro real fica com o parceiro de pagamento regulado.

## 1. Preço da corrida

```
variável = ceil( (metros × perKm × 60 + segundos × perMinuto × 1000) / 60000 )
calculado = base + variável
valor da corrida = max(calculado, piso)
```

- Distância em **metros** e tempo em **segundos** (inteiros). A parte variável arredonda **para cima** ao centavo (em favor do trabalhador).
- Os valores (`baseCents`, `perKmCents`, `perMinuteCents`, `minimumFareCents`) são **configuração** da associação, não constantes do código.
- **Versionamento:** cada tabela é um `PricingConfig` com `version` e `effectiveFrom` (UTC). `selectPricingConfig(configs, data)` escolhe a mais recente com `effectiveFrom <= data`. Versões antigas nunca são editadas; a corrida guarda a `configVersion` usada.

## 2. Divisão da corrida

Sobre o valor bruto `G`:

```
taxa base         = floor(G × 10 / 100)
taxa associação   = floor(G × r / 100),   r ∈ {0, 2, 4}
líquido trabalhador = G − taxa base − taxa associação
```

- **Arredondamento:** as duas taxas arredondam **para baixo**; o centavo quebrado fica com o trabalhador. Assim `taxa base + associação + líquido = G` sempre, e o líquido nunca é negativo.
- Ambas as taxas incidem sobre o **bruto** (decisão a confirmar, ver DECISOES.md).
- Exemplo: G = R$ 11,00, r = 2% → base R$ 1,10; associação R$ 0,22; **líquido R$ 9,68**.

## 3. Cotas e níveis

- **1 cota = R$ 5,00 (500 centavos).** A taxa de associação acumula; `cotas = floor(saldo / 500)` e `fração = saldo % 500` (0 a 499) fica guardada para as próximas corridas.
- No ledger, o saldo da conta `WORKER_QUOTAS:<id>` é a própria fonte: `quotaBalance(userId)` deriva cotas e fração dele (estornar uma corrida reduz as cotas).
- **Níveis:** Bronze 0–29, Prata 30–59, Ouro 60+ (`levelForQuotas`).
- Cotas e saldos são **registros contábeis**, não custódia de dinheiro.

## 4. Livro-razão (partidas dobradas)

Contas:

| Conta                 | Natureza | Significado                                  |
| --------------------- | -------- | -------------------------------------------- |
| `PARTNER_RECEIVABLE`  | devedora | a receber do parceiro de pagamento           |
| `WORKER_BALANCE:<id>` | credora  | ganhos líquidos do trabalhador               |
| `PLATFORM_REVENUE`    | credora  | taxa base (10%)                              |
| `WORKER_QUOTAS:<id>`  | credora  | taxa de associação (em centavos; vira cotas) |

Fechamento de uma corrida (`buildRideSettlement`):

```
DÉBITO  PARTNER_RECEIVABLE        G
CRÉDITO WORKER_BALANCE:<id>       líquido
CRÉDITO PLATFORM_REVENUE          taxa base
CRÉDITO WORKER_QUOTAS:<id>        taxa associação   (omitido se 0)
```

Regras do `Ledger`:

1. **Balanceada:** Σ débitos = Σ créditos, valores inteiros e positivos, mínimo 2 lançamentos. Lançamentos de valor zero são rejeitados.
2. **Append-only:** transações e lançamentos são congelados (`Object.freeze`); não há edição nem exclusão.
3. **Estorno:** `reverse(id)` grava uma nova transação com débitos e créditos invertidos (`reversalOf = id`). Cada transação só é estornada **uma vez**; estorno não é estornável. Para corrigir um erro: estornar e lançar de novo.
4. IDs de transação são únicos (idempotência no fechamento da corrida).

## 5. Persistência (Etapa 4)

O ledger agora vive no PostgreSQL (`LedgerTransaction` + `LedgerPosting`), gravado pelo serviço `LedgerService` com as partidas montadas por `buildRideSettlement`:

- **Quando:** ao `ENTREGUE` de um pedido de entrega, na mesma transação que muda o estado e congela as taxas no pedido.
- **Somente inserção, garantida pelo banco:** gatilho recusa `UPDATE` e `DELETE`; `amountCents > 0`; `(kind, reference)` único.
- **Taxa de associação:** vem de `DriverProfile.associationRate` no momento da conclusão.
- **Cotas:** `GET /driver/wallet` deriva cotas e fração do saldo da conta `WORKER_QUOTAS:<id>` (as tabelas antigas `QuotaAccount`/`QuotaEntry` não são mais usadas).
- **Estorno:** a regra existe no `Ledger` em memória do shared; o endpoint/serviço de estorno persistido ainda não foi implementado.

## 6. Pagamento do cliente (Etapa 6)

Código: `packages/shared/src/payment.ts`, `apps/api/src/payments`. O cliente paga o **valor da entrega inteiro** (`fareCents`); as taxas (seções 2–3) saem do que o motorista recebe, como antes. O dinheiro passa pelo **parceiro de pagamento regulado**; a AMMA guarda só o estado.

- **Quando cobra:** na criação do pedido (cartão: na hora; Pix: o cliente tem 15 min). O preço é o da cotação que o cliente viu (`expectedFareCents`); se a tabela mudou, o pedido é recusado antes de cobrar.
- **Quando entra no ledger:** o fechamento (seção 4) continua acontecendo só no `ENTREGUE`. Pagamento e ledger são independentes: o pagamento diz se o parceiro recebeu; o ledger diz como a corrida é dividida.
- **Cancelamento:** 100% estornado, qualquer que seja o motivo ou o ator (inclusive quando o cliente desiste depois de o motorista aceitar). Como nada é cobrado do cliente por cancelar, **o motorista que já estava a caminho não recebe nada**: multa/ressarcimento é regra de negócio ainda **não definida**.
- **Estorno é total e único:** `PAGO → ESTORNADO` uma vez só; o provedor recebe a mesma cobrança como chave, então repetir não devolve duas vezes.
- **Entrega concluída:** sem estorno automático. Estornar exigiria reverter o fechamento no ledger (hoje só existe em memória no `shared`, ver seção 5) e decidir quem arca com o repasse já feito ao motorista.
- **Relatório do comerciante:** gasto = soma de `fareCents` dos pedidos com pagamento `PAGO`; estornados aparecem à parte; Pix pendente/expirado não conta.

## 7. Corridas de passageiro (Etapa 7)

Código: `packages/shared/src/ride.ts`, `apps/api/src/rides`. **O dinheiro não muda**: a corrida entra no mesmo fechamento da seção 2–4 — taxa base 10%, taxa de associação 0/2/4%, cotas, ledger em partidas dobradas e pagamento/estorno da seção 6. Uma corrida de R$ 15,00 sem associação paga R$ 1,50 de taxa e R$ 13,50 ao motorista (testado).

- **Preço:** `calculateFare` com a mesma fórmula (base + km + minuto, com piso), mas a tabela vem do **perfil** da corrida: `CORRIDA_CARRO` ou `CORRIDA_MOTO` (`ENTREGA` segue como antes). Cada perfil é versionado à parte (`PricingConfigVersion.profile`). A rota é a mesma para os dois tipos; só a tabela muda. **Os valores de exemplo (seed) são inventados**; os reais são da associação.
- **Estimativa:** o passageiro vê o preço de cada tipo liberado antes de pedir; o pedido envia `expectedFareCents` e é recusado (409) se a tabela mudou.
- **Cancelamento:** até o embarque (`A_CAMINHO_COLETA`) o passageiro cancela com estorno total; depois de embarcar só o motorista (`ENTREGA_IMPOSSIVEL`) ou o admin encerram. Segue sem multa nem ressarcimento ao motorista (pendência da Etapa 6, agora mais visível: o motorista que foi buscar o passageiro e ele cancelou não recebe nada).
- **Ledger e ganhos:** corridas aparecem nos ganhos, no histórico e na carteira do motorista como qualquer pedido concluído.

## 8. Associação (Etapa 8)

Código: `packages/shared/src/{membership,assembly,group-purchase,insurance,surplus}.ts` e `ledger.ts`; serviços em `apps/api/src/association`. **A AMMA continua sem captar dinheiro nem conceder crédito:** aportes e sobras são **registros contábeis** no ledger; o dinheiro real fica com o parceiro regulado.

- **Sócio e nível:** sócio = ao menos 1 cota. Bronze 0–29, Prata 30–59, Ouro 60+. Progresso = `(cotas − início do nível) ÷ (início do próximo − início do nível)`; o que falta em centavos desconta a fração de cota já acumulada. Cotas são sempre lidas do ledger.
- **Aporte da compra coletiva** (`GROUP_CONTRIBUTION`, referência = id do aporte):
  ```
  DÉBITO  PARTNER_GROUP:<grupo>          valor   (registrado no parceiro; não é caixa da AMMA)
  CRÉDITO MEMBER_GROUP:<grupo>:<sócio>   valor   (quanto o sócio já aportou no grupo)
  ```
  Só nasce depois que o parceiro aceita, na mesma transação que grava o aporte. Não toca em `WORKER_BALANCE` nem em cotas. Aporte recusado fica registrado e **não** vai ao ledger.
- **Fila:** `pontos = cotas × peso_da_cota + dias_completos_de_fila × peso_do_dia`; mais pontos primeiro, empate = entrou antes, depois id. Pesos, mínimo de cotas e aporte mínimo são **configuração votada em assembleia** (versões somente inserção). A contemplação exige `aportes confirmados ÷ valor do veículo` maior que as já feitas.
- **Sobras anuais** (`SURPLUS_DISTRIBUTION`, referência = id do fechamento):
  ```
  DÉBITO  ASSOCIATION_SURPLUS            total distribuído
  CRÉDITO WORKER_BALANCE:<sócio>         parte de cada sócio (omitido se 0)
  ```
  - **Entrada:** o valor a distribuir é **informado pela associação** depois de fechar as contas do ano; o app não calcula resultado nem lucro.
  - **Sócios do ano:** quem tinha ≥ 1 cota **no fim do ano** (fuso UTC−3) e conta ativa. **Uso** = soma do valor bruto (`fareCents`) das entregas e corridas `ENTREGUE` no ano.
  - **Parte** = `total × ( p_uso × uso_i/Σuso + (100 − p_uso) × cotas_i/Σcotas ) ÷ 100`, em aritmética inteira exata (BigInt). Os centavos que sobram do arredondamento vão, um a um, para os **maiores restos** (empate: id), então a soma das partes é **sempre igual ao total**. `p_uso` padrão: 50%. Sem nenhum uso no ano, tudo vai pelas cotas.
  - **Simulação obrigatória:** o fechamento exige o `checksum` da simulação e só vale depois do fim do ano, uma vez por ano. Fechado, não muda (gatilho no banco); corrigir = lançamento novo, com decisão da associação.
