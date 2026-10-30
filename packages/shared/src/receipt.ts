import { businessDay } from './earnings';
import type { Cents } from './money';
import type { DeliveryStatus } from './delivery-state';
import type { PaymentMethod, PaymentStatus } from './payment';
import type { DeliveryKind } from './ride';

export interface ReceiptInput {
  deliveryId: string;
  /** Omitido = ENTREGA (recibos de antes das corridas). */
  kind?: DeliveryKind;
  createdAt: string;
  deliveredAt: string | null;
  status: DeliveryStatus;
  pickupAddress: string;
  dropoffAddress: string;
  distanceMeters: number;
  durationSeconds: number;
  fareCents: Cents;
  minimumApplied: boolean;
  pricingVersion: string;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    amountCents: Cents;
    cardBrand: string | null;
    cardLast4: string | null;
    paidAt: string | null;
    refundedAt: string | null;
  } | null;
}

export interface Receipt extends Omit<ReceiptInput, 'deliveryId'> {
  deliveryId: string;
  /** Ex.: AMMA-20261029-1A2B3C4D. Derivado do pedido: o mesmo pedido gera sempre o mesmo número. */
  number: string;
  /** Quanto o cliente pagou e não recebeu de volta. */
  paidCents: Cents;
  refundedCents: Cents;
  /** Aviso fixo: o recibo da AMMA não substitui nota fiscal. */
  notice: string;
}

export const RECEIPT_NOTICE =
  'Comprovante de pagamento da entrega. Não é nota fiscal; o pagamento é processado por parceiro regulado.';
export const RIDE_RECEIPT_NOTICE =
  'Comprovante de pagamento da corrida. Não é nota fiscal; o pagamento é processado por parceiro regulado.';

/** Recibo só existe para quem pagou (ou foi estornado): pedido sem pagamento confirmado não gera. */
export function canIssueReceipt(input: Pick<ReceiptInput, 'payment'>): boolean {
  const s = input.payment?.status;
  return s === 'PAGO' || s === 'ESTORNADO';
}

export function receiptNumber(deliveryId: string, createdAt: string): string {
  const day = businessDay(createdAt).replace(/-/g, '');
  return `AMMA-${day}-${deliveryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function buildReceipt(input: ReceiptInput): Receipt {
  if (!canIssueReceipt(input)) throw new Error('Recibo só para pagamento confirmado');
  const refunded = input.payment!.status === 'ESTORNADO';
  const amount = input.payment!.amountCents;
  return {
    ...input,
    number: receiptNumber(input.deliveryId, input.createdAt),
    paidCents: refunded ? 0 : amount,
    refundedCents: refunded ? amount : 0,
    notice: input.kind === 'CORRIDA' ? RIDE_RECEIPT_NOTICE : RECEIPT_NOTICE,
  };
}
