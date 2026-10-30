import { describe, expect, it } from 'vitest';
import { isValidCnpj, maskCnpj, merchantReport, type ReportDelivery } from './merchant';

describe('CNPJ', () => {
  it('valida dígitos verificadores', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });
  it('máscara parcial', () => {
    expect(maskCnpj('112')).toBe('11.2');
    expect(maskCnpj('11222333')).toBe('11.222.333');
    expect(maskCnpj('112223330001')).toBe('11.222.333/0001');
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
});

const now = new Date('2026-10-29T15:00:00Z');
const d = (createdAt: string, o: Partial<ReportDelivery>): ReportDelivery => ({
  createdAt,
  status: 'ENTREGUE',
  fareCents: 1000,
  paymentStatus: 'PAGO',
  ...o,
});

describe('merchantReport', () => {
  const list: ReportDelivery[] = [
    d('2026-10-29T12:00:00Z', {}),
    d('2026-10-29T13:00:00Z', { fareCents: 1500 }),
    d('2026-10-28T12:00:00Z', { status: 'CANCELADO', paymentStatus: 'ESTORNADO' }),
    d('2026-10-27T12:00:00Z', { status: 'A_CAMINHO_COLETA' }),
    d('2026-10-01T12:00:00Z', {}), // fora de 7 dias
    d('2026-10-29T14:00:00Z', { status: 'CRIADO', paymentStatus: 'PENDENTE', fareCents: 900 }),
  ];
  const r = merchantReport(list, now, 7);

  it('conta por situação', () => {
    expect(r.total).toBe(5);
    expect(r.delivered).toBe(2);
    expect(r.cancelled).toBe(1);
    expect(r.inProgress).toBe(2);
  });
  it('gasto = só o pago e não devolvido; Pix pendente não entra', () => {
    expect(r.spentCents).toBe(1000 + 1500 + 1000);
    expect(r.refundedCents).toBe(1000);
    expect(r.averageTicketCents).toBe(1166);
  });
  it('taxa de cancelamento', () => expect(r.cancelRatePercent).toBe(20));
  it('um item por dia, dias vazios zerados', () => {
    expect(r.perDay).toHaveLength(7);
    expect(r.perDay.at(-1)).toEqual({ date: '2026-10-29', deliveries: 3, spentCents: 2500 });
    expect(r.perDay[0]).toEqual({ date: '2026-10-23', deliveries: 0, spentCents: 0 });
  });
  it('sem pedidos: tudo zerado, sem dividir por zero', () => {
    const e = merchantReport([], now, 30);
    expect(e.total).toBe(0);
    expect(e.averageTicketCents).toBe(0);
    expect(e.cancelRatePercent).toBe(0);
  });
});
