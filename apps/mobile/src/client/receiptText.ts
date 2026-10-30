import { formatBRL, type PaymentMethod, type Receipt } from '@amma/shared';
import { formatDateTime } from '../driver/format';
import { METHOD_LABEL, PAYMENT_STATUS_LABEL } from './labels';

/** Forma de pagamento para o recibo: "Cartão visa final 4242" ou "Pix". */
export function paymentLine(p: {
  method: PaymentMethod;
  cardBrand: string | null;
  cardLast4: string | null;
}): string {
  return p.method === 'CARTAO' && p.cardLast4
    ? `Cartão ${p.cardBrand ?? ''} final ${p.cardLast4}`.replace('  ', ' ')
    : METHOD_LABEL[p.method];
}

/** Texto para compartilhar (WhatsApp, e-mail). Sem telefone nem dados do motorista. */
export function receiptText(r: Receipt): string {
  const p = r.payment!;
  return [
    `Recibo AMMA ${r.number}`,
    `Data: ${formatDateTime(r.createdAt)}`,
    `Coleta: ${r.pickupAddress}`,
    `Entrega: ${r.dropoffAddress}`,
    `Valor da entrega: ${formatBRL(r.fareCents)}`,
    `Pagamento: ${paymentLine(p)} (${PAYMENT_STATUS_LABEL[p.status]})`,
    r.refundedCents > 0
      ? `Estornado: ${formatBRL(r.refundedCents)}`
      : `Pago: ${formatBRL(r.paidCents)}`,
    '',
    r.notice,
  ].join('\n');
}
