import type { Receipt } from '@amma/shared';
import { paymentLine, receiptText } from '../receiptText';
import { plain } from '../../testing/fixtures';

const receipt: Receipt = {
  deliveryId: 'd1',
  number: 'AMMA-20261029-1A2B3C4D',
  createdAt: '2026-10-29T18:00:00Z',
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
    paidAt: null,
    refundedAt: null,
  },
  paidCents: 1100,
  refundedCents: 0,
  notice: 'Não é nota fiscal.',
};

describe('texto do recibo', () => {
  it('forma de pagamento', () => {
    expect(paymentLine(receipt.payment!)).toBe('Cartão visa final 4242');
    expect(paymentLine({ method: 'PIX', cardBrand: null, cardLast4: null })).toBe('Pix');
  });

  it('pago: lista número, endereços, valor e aviso', () => {
    const t = plain(receiptText(receipt));
    expect(t).toContain('Recibo AMMA AMMA-20261029-1A2B3C4D');
    expect(t).toContain('Coleta: Rua A, 1');
    expect(t).toContain('Valor da entrega: R$ 11,00');
    expect(t).toContain('Pago: R$ 11,00');
    expect(t).toContain('Não é nota fiscal.');
  });

  it('estornado: mostra o valor devolvido e não "Pago"', () => {
    const t = plain(
      receiptText({
        ...receipt,
        payment: { ...receipt.payment!, status: 'ESTORNADO' },
        paidCents: 0,
        refundedCents: 1100,
      }),
    );
    expect(t).toContain('Estornado: R$ 11,00');
    expect(t).not.toContain('Pago:');
  });

  it('nunca inclui telefone', () => {
    expect(receiptText(receipt)).not.toMatch(/\+55|\(\d{2}\)/);
  });
});
