import { businessDay, lastBusinessDays } from './earnings';
import type { Cents } from './money';
import type { DeliveryStatus } from './delivery-state';
import type { PaymentStatus } from './payment';

/** CNPJ com dígitos verificadores. */
export function isValidCnpj(input: string): boolean {
  const d = input.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (len: number) => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** 12345678000195 → 12.345.678/0001-95 (aceita digitação parcial). */
export function maskCnpj(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 14);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8)].filter(Boolean).join('.');
  const rest = d.length > 8 ? `/${d.slice(8, 12)}${d.length > 12 ? `-${d.slice(12)}` : ''}` : '';
  return parts + rest;
}

export const MERCHANT_REPORT_PERIODS = [7, 30, 90] as const;

export interface ReportDelivery {
  createdAt: string;
  status: DeliveryStatus;
  fareCents: Cents;
  paymentStatus: PaymentStatus | null;
}

export interface ReportDay {
  date: string;
  deliveries: number;
  spentCents: Cents;
}

export interface MerchantReport {
  days: number;
  from: string;
  to: string;
  total: number;
  delivered: number;
  cancelled: number;
  inProgress: number;
  /** Pago e não devolvido. */
  spentCents: Cents;
  refundedCents: Cents;
  /** Gasto médio por entrega paga (arredondado para baixo). */
  averageTicketCents: Cents;
  /** Cancelados / total, em %, uma casa decimal. */
  cancelRatePercent: number;
  perDay: ReportDay[];
}

/** Relatório simples do comerciante nos últimos `days` dias (dia = fuso de João Pessoa). */
export function merchantReport(list: ReportDelivery[], now: Date, days: number): MerchantReport {
  const dates = lastBusinessDays(now, days);
  const inRange = list.filter((d) => dates.includes(businessDay(d.createdAt)));
  const paid = inRange.filter((d) => d.paymentStatus === 'PAGO');
  const spentCents = paid.reduce((s, d) => s + d.fareCents, 0);
  const total = inRange.length;
  const cancelled = inRange.filter((d) => d.status === 'CANCELADO').length;
  return {
    days,
    from: dates[0]!,
    to: dates[dates.length - 1]!,
    total,
    delivered: inRange.filter((d) => d.status === 'ENTREGUE').length,
    cancelled,
    inProgress: inRange.filter((d) => d.status !== 'ENTREGUE' && d.status !== 'CANCELADO').length,
    spentCents,
    refundedCents: inRange
      .filter((d) => d.paymentStatus === 'ESTORNADO')
      .reduce((s, d) => s + d.fareCents, 0),
    averageTicketCents: paid.length ? Math.floor(spentCents / paid.length) : 0,
    cancelRatePercent: total ? Math.round((cancelled / total) * 1000) / 10 : 0,
    perDay: dates.map((date) => {
      const day = inRange.filter((d) => businessDay(d.createdAt) === date);
      return {
        date,
        deliveries: day.length,
        spentCents: day
          .filter((d) => d.paymentStatus === 'PAGO')
          .reduce((s, d) => s + d.fareCents, 0),
      };
    }),
  };
}
