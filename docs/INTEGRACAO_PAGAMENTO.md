# Ligar um provedor de pagamento real

A API já está pronta para receber um provedor (Pix + cartão, com divisão). Falta só o adaptador e as chaves. Nada aqui foi testado contra um provedor real.

## O que o provedor precisa oferecer

| Necessidade                                | Onde é usada                                           |
| ------------------------------------------ | ------------------------------------------------------ |
| Cobrança Pix com código "copia e cola"     | `createPix`                                            |
| Cartão por **token** (SDK no app)          | `chargeCard` (o número do cartão nunca passa pela API) |
| Estorno total, idempotente                 | `refund`                                               |
| Repasse a várias contas (split) ou saldo   | `settleSplit`                                          |
| Aviso de Pix pago com assinatura (webhook) | `parseWebhook` → `POST /payments/webhook`              |
| Ambiente de testes (sandbox) com chaves    | começar sempre por ele                                 |

## Passo a passo

1. Crie `apps/api/src/payments/<nome>-provider.ts` implementando `PaymentProvider` (`payment-provider.ts`). Use `fetch` com timeout e nunca coloque chave nem URL com chave em mensagem de erro (veja `MapboxRouteProvider`).
2. Registre em `REAL_PROVIDERS` (fim de `payment-provider.ts`). A fábrica valida as chaves e falha no boot se faltarem.
3. Variáveis: `PAYMENT_PROVIDER=<nome>`, `PAYMENT_WEBHOOK_SECRET` (obrigatório em produção) e as chaves do provedor (acrescente ao `.env.example`).
4. No provedor, cadastre a URL do aviso: `https://<API>/payments/webhook`.
5. No app, troque a tokenização de teste (`POST /payments/sandbox/card-tokens`, que some com provedor real) pelo SDK do provedor, em `apps/mobile/src/client/components/CardForm.tsx`.

## Regras que o adaptador precisa respeitar

- **Idempotência.** `refund` por `providerRef` e `settleSplit` por `reference` (id do pedido) podem ser chamados de novo: a API repete quando algo falha no meio.
- **Webhook.** `parseWebhook` recebe os bytes exatos do corpo (`rawBody`) e confere a assinatura com comparação em tempo constante; assinatura errada lança `InvalidWebhookError` (a API responde 401 sem tocar em nada). Devolva `{ eventId, type: 'PIX_PAID', providerRef }` ou `null` para avisos irrelevantes. A API ignora `eventId` repetido (tabela `PaymentWebhookEvent`).
- **Pix pago depois de vencer.** A API estorna sozinha (`refundReason = PIX_PAGO_APOS_VENCER`).
- **Valores** sempre em centavos inteiros.

## Divisão (split)

Só se sabe quem é o motorista e qual taxa vale **depois da entrega**. Por isso a cobrança entra inteira no parceiro e o repasse sai ao concluir (`PaymentsService.settleSplit`), com as taxas já congeladas no pedido (as mesmas do ledger):

| Destinatário  | Valor                         | Conta no provedor                  |
| ------------- | ----------------------------- | ---------------------------------- |
| `WORKER`      | líquido do trabalhador        | subconta do motorista (`workerId`) |
| `PLATFORM`    | taxa base (10%)               | conta da AMMA                      |
| `ASSOCIATION` | taxa da associação (0, 2, 4%) | conta da associação (omitida se 0) |

A soma sempre fecha com o valor cobrado (`buildPaymentSplit`, no `shared`); se não fechar, nada é enviado. Se o repasse falhar, a conclusão da entrega não é bloqueada e a rotina periódica repete (`PaymentsService.tick`).

## Pendências que dependem de decisão sua

- **Escolher o provedor** e contratar. Cada um tem um modelo de subcontas diferente: o adaptador precisa mapear `workerId` → conta do motorista (cadastro/KYC do motorista no provedor ainda não existe).
- Quem emite a nota/recibo fiscal e quem responde pelo dinheiro em trânsito: parecer jurídico (ver `docs/CHECKLIST_LANCAMENTO.md`).
- Contestação de cartão (chargeback) depois do repasse: hoje não há fluxo.

## Formas de pagamento: decisão de 2026-10-30

Hoje existem só **Pix** e **cartão** (`enum PaymentMethod { PIX, CARTAO }`). Ficou decidido **não mexer nisso por enquanto** (as duas opções abaixo ficam registradas para quando houver decisão de negócio).

### Cartão: crédito x débito

- O código **não distingue**: a tokenização guarda número, validade e CVV, sem campo de tipo. Não há parcelamento.
- Débito, com provedor real, é configuração da cobrança (ex.: `credit_card` / `debit_card`, o nome varia) e costuma exigir autenticação 3DS; as taxas do provedor são diferentes das do crédito.
- Para implementar: campo de tipo no modelo e na tela (`CardForm.tsx`), repassado ao adaptador (`PaymentProvider.charge`), e conferir se o provedor escolhido suporta débito.

### Dinheiro (em espécie)

Não é só mais uma opção na lista: muda o fluxo do dinheiro.

- **Repasse:** hoje a cobrança entra inteira na plataforma e o repasse sai depois da entrega. Com dinheiro o motorista recebe na mão; a taxa base e a da associação teriam de ser cobradas dele (saldo devedor no ledger, com bloqueio de novas corridas acima de um limite em aberto).
- **Calote:** sem pré-autorização, o passageiro pode se recusar a pagar no fim.
- **Segurança:** o motorista passa a carregar dinheiro (risco de assalto, disputa de troco).
- **Conciliação:** exige confirmação do recebimento pelo motorista, contestação pelo passageiro e cobertura de auditoria/antifraude.
- **Decisão pendente (👤):** como a associação quer cobrar a taxa do motorista e qual o limite de saldo devedor.
