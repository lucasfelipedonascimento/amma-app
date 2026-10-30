# Conectar um parceiro financeiro (consórcio ou cooperativa) à compra coletiva

Estado: **pronto para conectar, nenhum parceiro contratado**. `PURCHASE_PARTNER=sandbox` (padrão) só serve em desenvolvimento: nenhum dinheiro se move e a API recusa subir assim em produção.

## Princípio

A AMMA **não capta dinheiro nem concede crédito**. O sócio paga ao parceiro regulado; a AMMA só **registra** o aporte, monta a fila e a associação decide a contemplação. Um aporte só vira lançamento no ledger (e só conta para cobrir um veículo) quando o parceiro **confirma**.

## Como o aporte anda

```
sócio pede aporte → parceiro.registerContribution(reference)
   ├─ CONFIRMADO → grava + lança no ledger (mesma transação)
   ├─ RECUSADO   → grava com o motivo; nada no ledger
   └─ PENDENTE   → grava com as instruções de pagamento; o sócio paga ao parceiro
                      ├─ webhook assinado (POST /partner/webhook) ─┐
                      └─ conciliação periódica (fetchContribution) ┴→ CONFIRMADO ou RECUSADO
```

- Parceiro fora do ar (`PartnerUnavailableError`) → 503 e **nada é gravado**; o sócio tenta de novo com a mesma chave de idempotência.
- A troca PENDENTE → final é condicional e o lançamento vai na mesma transação: aviso repetido, em paralelo ou depois da conciliação **não lança duas vezes**. Aporte já decidido não muda de status (divergência vira aviso no log).
- Avisos repetidos são ignorados por `(parceiro, eventId)` (`PartnerWebhookEvent`). Falha nossa apaga o registro do aviso para o parceiro poder reenviar.
- Aviso para aporte desconhecido: 200 e aviso no log (reenviar não adianta).
- Conciliação: a rotina do `AssociationScheduler` (a cada `ASSOCIATION_TICK_MS`) pergunta ao parceiro pelos PENDENTES parados há mais de 5 min.
- Sócio com aporte CONFIRMADO ou PENDENTE não sai da fila sozinho (a devolução é combinada com a associação e o parceiro).

## Passo a passo para plugar um parceiro

1. Crie `apps/api/src/association/<nome>-partner.ts` implementando `PurchasePartner` (`partner.ts`):
   - `registerContribution`: **idempotente por `reference`** (o id do aporte). Devolva `CONFIRMADO`, `RECUSADO` ou `PENDENTE` (com `instructions`: link, código Pix ou linha do boleto que o app mostra). Lance `PartnerUnavailableError` em timeout ou erro 5xx; não confunda falha com recusa.
   - `fetchContribution(partnerRef)`: situação atual de um aporte já registrado.
   - `parseWebhook(rawBody, headers)`: confira a assinatura sobre os **bytes exatos** (HMAC, comparação em tempo constante), lance `InvalidPartnerWebhookError` se não bater, devolva `PartnerEvent` (`eventId`, `partnerRef`, `outcome`, `reason`) ou `null` para avisos irrelevantes.
2. Registre em `REAL_PARTNERS` (`partner.ts`): `REAL_PARTNERS.<nome> = (config) => new MeuParceiro(config.getOrThrow('...'))`. Faltando chave, a API falha no boot.
3. Ative com `PURCHASE_PARTNER=<nome>` e `PARTNER_WEBHOOK_SECRET` (obrigatório em produção). Acrescente as chaves ao `.env.example`.
4. Cadastre no painel do parceiro a URL `https://<api>/partner/webhook`.
5. Teste primeiro no ambiente de testes do parceiro. Use `test/group-purchase.int.test.ts` (bloco "parceiro confirma depois") como roteiro dos comportamentos esperados.

## Regras

- Nada de chave, documento ou dado de pagamento em log. A rota `/partner/webhook` é pública de propósito; a autenticidade vem **só** da assinatura.
- O corpo do webhook nunca decide valor nem sócio: ele só localiza o aporte por `partnerRef` e informa o resultado. Valor e dono vêm do que a AMMA gravou.
- Se o parceiro informar um valor confirmado diferente do registrado, trate no adaptador (lance erro ou devolva `RECUSADO`); a API confia no que foi registrado.

## O que o app e a API já têm

- `Contribution.status`: `PENDENTE | CONFIRMADO | RECUSADO`, `instructions` (só enquanto pendente), `confirmedAt`, `partnerRef` único por parceiro.
- App: aporte pendente mostra "Aguardando o parceiro" e as instruções de pagamento.
- Migração `20261106120000_parceiro_aporte_pendente` (rode `prisma:deploy`).

## Decisões suas (👤, dependem de contrato e de advogado)

- **Qual parceiro e qual modalidade** (consórcio administrado por administradora autorizada pelo Banco Central, ou cooperativa de crédito). A AMMA não pode ela mesma captar ou prometer contemplação sem autorização; o jurídico deve validar o texto "contemplação pela associação" frente à lei de consórcios.
- **Contrato**: quem é o titular da cota (o sócio, não a AMMA), taxas, prazo, o que acontece em desistência, inadimplência e devolução (hoje o app bloqueia sair da fila com aporte).
- **Como o contemplado recebe o veículo** e quem emite a nota/documento.
- **Prazo de expiração** de um aporte PENDENTE que nunca é pago (hoje fica pendente até o parceiro recusar; o parceiro costuma recusar/expirar o boleto).
- **Estorno/devolução** de aporte já confirmado: não existe no app; é manual entre associação e parceiro.
- **LGPD**: o que a AMMA pode enviar ao parceiro (hoje só `reference`, `groupId`, `userId` e valor; o parceiro precisará de CPF/dados do sócio, que deve ser coletado por ele, não pela AMMA).
