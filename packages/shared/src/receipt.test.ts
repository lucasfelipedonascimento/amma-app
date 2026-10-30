import { describe, expect, it } from 'vitest';
import { buildReceipt, canIssueReceipt, receiptNumber, type ReceiptInput } from './receipt';

const base: ReceiptInput = {
  deliveryId: '1a2b3c4d-0000-4000-8000-000000000000',
  createdAt: '2026-10-30T01:00:00Z', // 29/10 22h em João Pessoa
  deliveredAt: null,
  status: 'ENTREGUE',
  pickupAddress: 'Rua A, 1',
  dropoffAddress: 'Rua B, 2',
  distanceMeters: 3000,
  durationSeconds: 600,
  fareCents: 1100,
  minimumApplied: true,
  pricingVersion: 'v1',
  payment: {
    method: 'CARTAO',
    status: 'PAGO',
    amountCents: 1100,
    cardBrand: 'visa',
    cardLast4: '4242',
    paidAt: '2026-10-30T01:00:05Z',
    refundedAt: null,
  },
};

describe('recibo', () => {
  it('número usa o dia no fuso de João Pessoa e o início do id', () => {
    expect(receiptNumber(base.deliveryId, base.createdAt)).toBe('AMMA-20261029-1A2B3C4D');
  });
  it('pago: mostra o valor pago', () => {
    const r = buildReceipt(base);
    expect(r.paidCents).toBe(1100);
    expect(r.refundedCents).toBe(0);
    expect(r.notice).toMatch(/não é nota fiscal/i);
  });
  it('estornado: nada pago, valor devolvido', () => {
    const r = buildReceipt({ ...base, payment: { ...base.payment!, status: 'ESTORNADO' } });
    expect(r.paidCents).toBe(0);
    expect(r.refundedCents).toBe(1100);
  });
  it('sem pagamento confirmado não há recibo', () => {
    expect(canIssueReceipt({ payment: null })).toBe(false);
    expect(canIssueReceipt({ payment: { ...base.payment!, status: 'PENDENTE' } })).toBe(false);
    expect(() => buildReceipt({ ...base, payment: null })).toThrow();
  });
});
