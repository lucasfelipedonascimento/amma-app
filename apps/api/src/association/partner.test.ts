import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import {
  InvalidPartnerWebhookError,
  PartnerUnavailableError,
  SANDBOX_PARTNER_DOWN_CENTS,
  SANDBOX_PARTNER_PENDING_CENTS,
  SandboxPurchasePartner,
  createPurchasePartner,
} from './partner';

const c = (amountCents: number, reference = 'r1') => ({
  reference,
  groupId: 'g',
  userId: 'u',
  amountCents,
});

describe('parceiro simulado', () => {
  it('aceita, recusa acima do limite, fica pendente e cai fora do ar por valor', async () => {
    const p = new SandboxPurchasePartner();
    expect((await p.registerContribution(c(100_00))).status).toBe('CONFIRMADO');
    expect((await p.registerContribution(c(10_000_01, 'r2'))).status).toBe('RECUSADO');
    expect((await p.registerContribution(c(SANDBOX_PARTNER_PENDING_CENTS, 'r3'))).status).toBe(
      'PENDENTE',
    );
    await expect(p.registerContribution(c(SANDBOX_PARTNER_DOWN_CENTS, 'r4'))).rejects.toThrow(
      PartnerUnavailableError,
    );
  });

  it('é idempotente por referência', async () => {
    const p = new SandboxPurchasePartner();
    const a = await p.registerContribution(c(100_00));
    const b = await p.registerContribution(c(100_00));
    expect(b).toEqual(a);
  });

  it('webhook: assinatura errada é recusada; tipos desconhecidos viram null', () => {
    const p = new SandboxPurchasePartner('segredo');
    const raw = Buffer.from(
      JSON.stringify({ id: 'e', type: 'contribution.confirmed', partnerRef: 'x' }),
    );
    expect(() => p.parseWebhook(raw, { 'x-amma-signature': 'a'.repeat(64) })).toThrow(
      InvalidPartnerWebhookError,
    );
    expect(p.parseWebhook(raw, { 'x-amma-signature': p.sign(raw) })).toEqual({
      eventId: 'e',
      partnerRef: 'x',
      outcome: 'CONFIRMADO',
    });
    const other = Buffer.from(JSON.stringify({ id: 'e', type: 'x', partnerRef: 'x' }));
    expect(p.parseWebhook(other, { 'x-amma-signature': p.sign(other) })).toBeNull();
  });
});

describe('createPurchasePartner', () => {
  const cfg = (env: Record<string, string>) =>
    ({ get: (k: string) => env[k] }) as unknown as ConfigService;
  it('modo sem parceiro registrado não sobe', () => {
    expect(() => createPurchasePartner(cfg({ PURCHASE_PARTNER: 'cooperativa' }))).toThrow(
      /PURCHASE_PARTNER inválido: cooperativa/,
    );
  });
  it('sandbox é recusado em produção', () => {
    expect(() => createPurchasePartner(cfg({ NODE_ENV: 'production' }))).toThrow(/produção/);
  });
});
