import type { Cents } from './money';
import type { DeliveryStatus } from './delivery-state';

/** Formas de pagamento do cliente. O dinheiro passa pelo parceiro regulado, nunca pela AMMA. */
export const PAYMENT_METHODS = ['PIX', 'CARTAO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 *   PENDENTE ──► PAGO ──► ESTORNADO
 *      └───────► EXPIRADO   (Pix não pago a tempo, ou pedido cancelado antes de pagar)
 */
export const PAYMENT_STATUSES = ['PENDENTE', 'PAGO', 'EXPIRADO', 'ESTORNADO'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDENTE: ['PAGO', 'EXPIRADO'],
  PAGO: ['ESTORNADO'],
  EXPIRADO: [],
  ESTORNADO: [],
};

export const canTransitionPayment = (from: PaymentStatus, to: PaymentStatus): boolean =>
  TRANSITIONS[from].includes(to);

/** Tempo para o cliente pagar o Pix antes de o pedido ser cancelado. */
export const PIX_TTL_SECONDS = 15 * 60;

/**
 * O que fazer com o pagamento conforme o estado do pedido:
 * - ESTORNAR: pedido cancelado e já pago → devolve tudo.
 * - EXPIRAR: pedido cancelado e ainda não pago → o Pix deixa de valer.
 * - MANUAL: pedido entregue → estorno só pelo admin, depois de analisar o caso (regra de disputa ainda a definir).
 * - NADA: nada a fazer.
 */
export type RefundAction = 'ESTORNAR' | 'EXPIRAR' | 'MANUAL' | 'NADA';

export function refundAction(delivery: DeliveryStatus, payment: PaymentStatus): RefundAction {
  if (delivery === 'CANCELADO') {
    if (payment === 'PAGO') return 'ESTORNAR';
    if (payment === 'PENDENTE') return 'EXPIRAR';
    return 'NADA';
  }
  if (delivery === 'ENTREGUE' && payment === 'PAGO') return 'MANUAL';
  return 'NADA';
}

/** O despacho só começa com o pagamento confirmado. Pedido sem pagamento (legado) segue livre. */
export const canDispatch = (payment: PaymentStatus | null): boolean =>
  payment === null || payment === 'PAGO';

// ---------- Cartão (validações de digitação; o número nunca é guardado) ----------

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Algoritmo de Luhn: pega erro de digitação no número do cartão. */
export function isValidCardNumber(input: string): boolean {
  const d = digitsOf(input);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo' | 'outra';

export function cardBrand(input: string): CardBrand {
  const d = digitsOf(input);
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d))
    return 'elo';
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  return 'outra';
}

/** 4242424242424242 → 4242 4242 4242 4242 (aceita digitação parcial). */
export function maskCardNumber(input: string): string {
  const d = digitsOf(input).slice(0, 19);
  return d.replace(/(.{4})(?=.)/g, '$1 ');
}

/** 1229 → 12/29 (aceita digitação parcial). */
export function maskCardExpiry(input: string): string {
  const d = digitsOf(input).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** "12/29" → { month: 12, year: 2029 }; null se inválido ou já vencido (vale até o fim do mês). */
export function parseCardExpiry(
  input: string,
  now = new Date(),
): { month: number; year: number } | null {
  const m = input.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return null;
  const endOfMonth = Date.UTC(year, month, 1);
  return endOfMonth > now.getTime() ? { month, year } : null;
}

export const isValidCardCvv = (input: string, brand: CardBrand = 'outra'): boolean =>
  new RegExp(`^\\d{${brand === 'amex' ? 4 : 3}}$`).test(input);

export const lastFour = (input: string): string => digitsOf(input).slice(-4);

/** Valor mínimo cobrável (centavos). Abaixo disso os provedores recusam. */
export const MIN_CHARGE_CENTS: Cents = 100;
