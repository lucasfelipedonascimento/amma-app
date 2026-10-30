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
