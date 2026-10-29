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

> A persistência do ledger no PostgreSQL (tabela somente-inserção) entra quando as corridas forem implementadas.
