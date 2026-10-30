import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxPaymentProvider } from '../src/payments/payment-provider';
import { PaymentsService } from '../src/payments/payments.service';
import { DROPOFF, PICKUP, TestApp, near, type TestUser } from './helpers';

describe('webhook de pagamento e repasse (split)', () => {
  let t: TestApp;
  let client: TestUser;
  let driver: TestUser;
  const provider = () => t.app.get(PaymentsService).provider as SandboxPaymentProvider;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    client = await t.client();
    driver = await t.driver('Maria');
    await t.online(driver, near(300));
  });

  const pixOrder = async () =>
    (
      await t.post('/deliveries', client.token, {
        pickup: PICKUP,
        dropoff: DROPOFF,
        payment: { method: 'PIX' },
      })
    ).body;

  const webhook = async (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    const res = await fetch(`${t.baseUrl}/payments/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-amma-signature': signature ?? provider().sign(raw),
      },
      body: raw,
    });
    return res.status;
  };
  const paid = (providerRef: string, id = 'evt_1') => ({ id, type: 'pix.paid', providerRef });
  const refOf = async (deliveryId: string) =>
    (await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId } })).providerRef;

  describe('webhook', () => {
    it('sem assinatura válida: 401 e nada muda', async () => {
      const d = await pixOrder();
      const ref = await refOf(d.id);
      expect(await webhook(paid(ref), 'a'.repeat(64))).toBe(401);
      expect(await webhook(paid(ref), 'curta')).toBe(401);
      const p = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } });
      expect(p.status).toBe('PENDENTE');
    });

    it('Pix pago: marca como pago e manda o pedido ao despacho', async () => {
      const d = await pixOrder();
      expect(await webhook(paid(await refOf(d.id)))).toBe(200);
      const p = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } });
      expect(p.status).toBe('PAGO');
      expect((await t.currentOffer(driver))?.id).toBeTruthy();
    });

    it('aviso repetido é ignorado (200, sem efeito duplo)', async () => {
      const d = await pixOrder();
      const ref = await refOf(d.id);
      expect(await webhook(paid(ref))).toBe(200);
      expect(await webhook(paid(ref))).toBe(200);
      expect(await t.prisma.paymentWebhookEvent.count()).toBe(1);
    });

    it('cobrança desconhecida e tipos que não interessam: 200', async () => {
      expect(await webhook(paid('pix_sbx_nao-existe'))).toBe(200);
      expect(await webhook({ id: 'x', type: 'outro.evento', providerRef: 'y' })).toBe(200);
    });

    it('Pix pago depois de vencer: devolve o dinheiro ao cliente', async () => {
      const d = await pixOrder();
      await t.prisma.payment.update({
        where: { deliveryId: d.id },
        data: { pixExpiresAt: new Date(Date.now() - 1000) },
      });
      await t.app.get(PaymentsService).tick();
      expect(await webhook(paid(await refOf(d.id)))).toBe(200);
      const p = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } });
      expect(p).toMatchObject({ status: 'ESTORNADO', refundReason: 'PIX_PAGO_APOS_VENCER' });
    });
  });

  describe('repasse (split)', () => {
    it('ao concluir, repassa trabalhador, taxa base e associação e registra', async () => {
      const calls: unknown[] = [];
      const orig = provider().settleSplit.bind(provider());
      provider().settleSplit = async (r) => {
        calls.push(r);
        return orig(r);
      };
      await t.prisma.driverProfile.update({
        where: { userId: driver.id },
        data: { associationRate: 2 },
      });
      const id = await t.runToDelivered(client, driver);
      expect(calls).toHaveLength(1);
      expect((calls[0] as { lines: unknown[] }).lines).toEqual([
        { recipient: 'WORKER', workerId: driver.id, amountCents: 968 },
        { recipient: 'PLATFORM', amountCents: 110 },
        { recipient: 'ASSOCIATION', amountCents: 22 },
      ]);
      const p = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: id } });
      expect(p.splitSettledAt).not.toBeNull();
      expect(p.splitRef).toMatch(/^split_sbx_/);
    });

    it('falha no provedor não impede a conclusão; a rotina repete depois', async () => {
      const orig = provider().settleSplit.bind(provider());
      provider().settleSplit = async () => {
        throw new Error('provedor fora');
      };
      const id = await t.runToDelivered(client, driver);
      const delivery = await t.prisma.delivery.findUniqueOrThrow({ where: { id } });
      expect(delivery.status).toBe('ENTREGUE');
      expect(
        (await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: id } })).splitSettledAt,
      ).toBeNull();

      provider().settleSplit = orig;
      await t.app.get(PaymentsService).tick();
      expect(
        (await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: id } })).splitSettledAt,
      ).not.toBeNull();
    });
  });
});
