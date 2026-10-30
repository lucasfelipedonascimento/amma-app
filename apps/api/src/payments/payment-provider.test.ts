import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import {
  PaymentUnavailableError,
  SandboxPaymentProvider,
  createPaymentProvider,
} from './payment-provider';

const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: 2099, cvv: '123' };
const now = new Date('2026-10-30T12:00:00Z');

describe('SandboxPaymentProvider', () => {
  const p = new SandboxPaymentProvider();

  it('tokeniza sem carregar o número do cartão', () => {
    const t = p.tokenizeCard(card, now);
    expect(t).toEqual({ token: 'sbx_ok_4242_visa', brand: 'visa', last4: '4242' });
    expect(t.token).not.toContain('4242 4242');
  });

  it('cartões de teste dão cada resultado', async () => {
    const charge = (number: string) =>
      p.chargeCard({
        reference: 'r',
        amountCents: 1100,
        cardToken: p.tokenizeCard({ ...card, number }, now).token,
      });
    expect(await charge('4242424242424242')).toMatchObject({ approved: true, last4: '4242' });
    expect(await charge('4000000000000002')).toEqual({
      approved: false,
      reason: 'Cartão recusado pelo banco',
    });
    expect(await charge('4000000000009995')).toEqual({
      approved: false,
      reason: 'Saldo insuficiente',
    });
    await expect(charge('4000000000000119')).rejects.toBeInstanceOf(PaymentUnavailableError);
  });

  it('recusa token desconhecido e dados inválidos', async () => {
    expect(await p.chargeCard({ reference: 'r', amountCents: 1, cardToken: 'xyz' })).toMatchObject({
      approved: false,
    });
    expect(() => p.tokenizeCard({ ...card, number: '4242 4242 4242 4241' }, now)).toThrow(
      /inválido/,
    );
    expect(() => p.tokenizeCard({ ...card, expYear: 2026, expMonth: 9 }, now)).toThrow(/vencido/);
    expect(() => p.tokenizeCard({ ...card, cvv: '12' }, now)).toThrow(/segurança/);
  });

  it('estorno é idempotente por cobrança', async () => {
    const a = await p.refund({ providerRef: 'x', amountCents: 100 });
    const b = await p.refund({ providerRef: 'x', amountCents: 100 });
    expect(a.refundRef).toBe(b.refundRef);
    expect((await p.refund({ providerRef: 'y', amountCents: 100 })).refundRef).not.toBe(
      a.refundRef,
    );
  });

  it('Pix simulado é identificável como falso', async () => {
    const pix = await p.createPix({ reference: 'r', amountCents: 500, expiresAt: new Date() });
    expect(pix.pixCode).toMatch(/^PIX-SIMULADO/);
  });
});

describe('createPaymentProvider', () => {
  const cfg = (v: Record<string, string>) =>
    ({ get: (k: string) => v[k] }) as unknown as ConfigService;
  it('sandbox é o padrão, mas não em produção', () => {
    expect(createPaymentProvider(cfg({}))).toBeInstanceOf(SandboxPaymentProvider);
    expect(() => createPaymentProvider(cfg({ NODE_ENV: 'production' }))).toThrow(/produção/);
  });
  it('provedor desconhecido falha ao iniciar', () => {
    expect(() => createPaymentProvider(cfg({ PAYMENT_PROVIDER: 'stripe' }))).toThrow(/inválido/);
  });
});
