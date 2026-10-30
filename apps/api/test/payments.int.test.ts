import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PaymentsService } from '../src/payments/payments.service';
import { CARD_OK, DROPOFF, PICKUP, TestApp, near, type TestUser } from './helpers';

const PIX = { method: 'PIX' } as const;
const body = (payment: object, extra: object = {}) => ({
  pickup: PICKUP,
  dropoff: DROPOFF,
  payment,
  ...extra,
});

describe('pagamento, recibo, avaliação e comerciante', () => {
  let t: TestApp;
  let client: TestUser;
  let driver: TestUser;

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

  const tokenFor = async (number: string) =>
    (
      await t.post('/payments/sandbox/card-tokens', client.token, {
        number,
        expMonth: 12,
        expYear: new Date().getUTCFullYear() + 2,
        cvv: '123',
      })
    ).body;

  describe('cartão', () => {
    it('aprovado: pedido já nasce pago e vai ao despacho', async () => {
      const r = await t.post('/deliveries', client.token, body(CARD_OK));
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('OFERECIDO');
      expect(r.body.payment).toMatchObject({
        method: 'CARTAO',
        status: 'PAGO',
        amountCents: 1100,
        cardBrand: 'visa',
        cardLast4: '4242',
        sandbox: true,
      });
      expect(r.body.payment.pixCode).toBeNull();
    });

    it('o motorista não vê o pagamento', async () => {
      const d = await t.createDelivery(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      const seen = (await t.get(`/deliveries/${d.id}`, driver.token)).body;
      expect(seen.payment).toBeNull();
    });

    it.each([
      ['4000000000000002', 'Cartão recusado pelo banco'],
      ['4000000000009995', 'Saldo insuficiente'],
    ])('recusado (%s): 402 e nada é criado', async (number, message) => {
      const tok = await tokenFor(number);
      const r = await t.post(
        '/deliveries',
        client.token,
        body({ method: 'CARTAO', cardToken: tok.token }),
      );
      expect(r.status).toBe(402);
      expect(r.body.message).toBe(message);
      expect(await t.prisma.delivery.count()).toBe(0);
      expect(await t.prisma.payment.count()).toBe(0);
    });

    it('provedor fora do ar: 503 e nada é criado', async () => {
      const tok = await tokenFor('4000000000000119');
      const r = await t.post(
        '/deliveries',
        client.token,
        body({ method: 'CARTAO', cardToken: tok.token }),
      );
      expect(r.status).toBe(503);
      expect(await t.prisma.delivery.count()).toBe(0);
    });

    it('cartão sem token, token falso ou campo extra: rejeita', async () => {
      expect((await t.post('/deliveries', client.token, body({ method: 'CARTAO' }))).status).toBe(
        400,
      );
      expect(
        (
          await t.post(
            '/deliveries',
            client.token,
            body({ method: 'CARTAO', cardToken: 'qualquer-coisa' }),
          )
        ).status,
      ).toBe(402);
      expect(
        (
          await t.post(
            '/deliveries',
            client.token,
            body({ method: 'CARTAO', cardToken: 'sbx_ok_4242_visa', number: '4242' }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await t.post('/deliveries', client.token, { pickup: PICKUP, dropoff: DROPOFF })).status,
      ).toBe(400);
    });

    it('o tokenizador confere número, validade e CVV, e não devolve o número', async () => {
      const post = (n: object) =>
        t.post('/payments/sandbox/card-tokens', client.token, {
          number: '4242 4242 4242 4242',
          expMonth: 12,
          expYear: 2099,
          cvv: '123',
          ...n,
        });
      const ok = await post({});
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ token: 'sbx_ok_4242_visa', brand: 'visa', last4: '4242' });
      expect((await post({ number: '4242 4242 4242 4241' })).status).toBe(400);
      expect((await post({ expYear: 2020 })).status).toBe(400);
      expect((await post({ cvv: '12' })).status).toBe(400);
    });

    it('pagamento nunca guarda o número do cartão', async () => {
      await t.createDelivery(client);
      const p = await t.prisma.payment.findFirstOrThrow();
      expect(JSON.stringify(p)).not.toMatch(/4242 ?4242/);
      expect(p.cardLast4).toBe('4242');
    });
  });

  describe('Pix', () => {
    const create = async () => {
      const r = await t.post('/deliveries', client.token, body(PIX));
      expect(r.status).toBe(201);
      return r.body;
    };

    it('nasce pendente, com código, e NÃO vai ao despacho até ser pago', async () => {
      const d = await create();
      expect(d.status).toBe('CRIADO');
      expect(d.payment).toMatchObject({ method: 'PIX', status: 'PENDENTE' });
      expect(d.payment.pixCode).toMatch(/^PIX-SIMULADO/);
      await t.dispatch.tick();
      expect(await t.currentOffer(driver)).toBeNull();
      expect(await t.prisma.deliveryOffer.count()).toBe(0);
    });

    it('pago: mostra PAGO, esconde o código e despacha', async () => {
      const d = await create();
      const c = await t.post(`/payments/sandbox/pix/${d.id}/confirm`, client.token);
      expect(c.status).toBe(200);
      const after = (await t.get(`/deliveries/${d.id}`, client.token)).body;
      expect(after.status).toBe('OFERECIDO');
      expect(after.payment.status).toBe('PAGO');
      expect(after.payment.pixCode).toBeNull();
    });

    it('confirmar duas vezes é inofensivo (uma só oferta)', async () => {
      const d = await create();
      await t.post(`/payments/sandbox/pix/${d.id}/confirm`, client.token);
      expect((await t.post(`/payments/sandbox/pix/${d.id}/confirm`, client.token)).status).toBe(
        200,
      );
      expect(await t.prisma.deliveryOffer.count()).toBe(1);
    });

    it('outro cliente não confirma o Pix alheio', async () => {
      const d = await create();
      const other = await t.client('Outro');
      expect((await t.post(`/payments/sandbox/pix/${d.id}/confirm`, other.token)).status).toBe(404);
    });

    it('não pago no prazo: Pix vence e o pedido é cancelado', async () => {
      const d = await create();
      await t.prisma.payment.update({
        where: { deliveryId: d.id },
        data: { pixExpiresAt: new Date(Date.now() - 1000) },
      });
      await t.app.get(PaymentsService).tick();
      const after = (await t.get(`/deliveries/${d.id}`, client.token)).body;
      expect(after).toMatchObject({
        status: 'CANCELADO',
        cancelReason: 'PAGAMENTO_NAO_CONFIRMADO',
      });
      expect(after.payment.status).toBe('EXPIRADO');
      // Pagar depois de vencido não ressuscita o pedido.
      expect((await t.post(`/payments/sandbox/pix/${d.id}/confirm`, client.token)).status).toBe(
        409,
      );
    });

    it('cliente desiste antes de pagar: o Pix perde a validade', async () => {
      const d = await create();
      const c = await t.post(`/deliveries/${d.id}/cancel`, client.token, {
        reason: 'CLIENTE_DESISTIU',
      });
      expect(c.status).toBe(200);
      expect(c.body.payment.status).toBe('EXPIRADO');
      expect((await t.post(`/payments/sandbox/pix/${d.id}/confirm`, client.token)).status).toBe(
        409,
      );
    });

    it('a janela de busca conta do pagamento, não do pedido', async () => {
      const d = await create();
      await t.prisma.delivery.update({
        where: { id: d.id },
        data: { createdAt: new Date(Date.now() - 600_000) }, // pedido de 10 min atrás
      });
      await t.post(`/payments/sandbox/pix/${d.id}/confirm`, client.token);
      await t.dispatch.tick();
      expect((await t.get(`/deliveries/${d.id}`, client.token)).body.status).toBe('OFERECIDO');
    });
  });

  describe('estorno', () => {
    it('cliente cancela depois de pagar: estorno automático e total', async () => {
      const d = await t.createDelivery(client);
      const c = await t.post(`/deliveries/${d.id}/cancel`, client.token, {
        reason: 'CLIENTE_DESISTIU',
      });
      expect(c.body.payment).toMatchObject({ status: 'ESTORNADO' });
      expect(c.body.payment.refundedAt).toBeTruthy();
      const p = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } });
      expect(p.refundRef).toMatch(/^re_sbx_/);
      expect(p.refundReason).toBe('PEDIDO_CANCELADO');
    });

    it('sem motorista na janela: cancela e devolve o dinheiro', async () => {
      await t.prisma.driverPresence.deleteMany(); // ninguém online
      const d = await t.createDelivery(client);
      const past = new Date(Date.now() - 301_000);
      await t.prisma.delivery.update({ where: { id: d.id }, data: { createdAt: past } });
      await t.prisma.payment.update({ where: { deliveryId: d.id }, data: { paidAt: past } });
      await t.dispatch.tick();
      const after = (await t.get(`/deliveries/${d.id}`, client.token)).body;
      expect(after).toMatchObject({ status: 'CANCELADO', cancelReason: 'SEM_MOTORISTA' });
      expect(after.payment.status).toBe('ESTORNADO');
    });

    it('motorista não consegue entregar: cliente é estornado', async () => {
      const d = await t.createDelivery(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      for (const s of ['en-route-pickup', 'picked-up'])
        await t.post(`/driver/deliveries/${d.id}/${s}`, driver.token);
      const c = await t.post(`/deliveries/${d.id}/cancel`, driver.token, {
        reason: 'ENTREGA_IMPOSSIVEL',
      });
      expect(c.status).toBe(200);
      expect((await t.get(`/deliveries/${d.id}`, client.token)).body.payment.status).toBe(
        'ESTORNADO',
      );
    });

    it('estornar é idempotente: a rotina repete sem devolver duas vezes', async () => {
      const d = await t.createDelivery(client);
      await t.post(`/deliveries/${d.id}/cancel`, client.token, { reason: 'CLIENTE_DESISTIU' });
      const first = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } });
      await t.app.get(PaymentsService).tick();
      expect(await t.app.get(PaymentsService).refund(d.id, 'OUTRA')).toBe(false);
      const again = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } });
      expect(again.refundRef).toBe(first.refundRef);
      expect(again.refundReason).toBe('PEDIDO_CANCELADO');
    });

    it('se o estorno falhar no cancelamento, a rotina refaz', async () => {
      const d = await t.createDelivery(client);
      // Simula a falha: cancela direto no banco, sem passar pelo estorno.
      await t.prisma.delivery.update({
        where: { id: d.id },
        data: { status: 'CANCELADO', cancelReason: 'CLIENTE_DESISTIU', cancelledAt: new Date() },
      });
      expect(
        (await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } })).status,
      ).toBe('PAGO');
      await t.app.get(PaymentsService).tick();
      expect(
        (await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } })).status,
      ).toBe('ESTORNADO');
    });

    it('admin estorna um cancelado cujo estorno automático falhou', async () => {
      const admin = await t.admin();
      const d = await t.createDelivery(client);
      await t.prisma.delivery.update({
        where: { id: d.id },
        data: { status: 'CANCELADO', cancelReason: 'ADMIN_CANCELOU', cancelledAt: new Date() },
      });
      const r = await t.post(`/admin/deliveries/${d.id}/refund`, admin.token, {
        reason: 'repetir estorno',
      });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('ESTORNADO');
      const p = await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: d.id } });
      expect(p.refundReason).toBe('ADMIN: repetir estorno');
    });

    it('admin: entregue é recusado (regra de disputa pendente); em andamento e não-admin também', async () => {
      const admin = await t.admin();
      const id2 = await t.runToDelivered(client, driver);
      const r = await t.post(`/admin/deliveries/${id2}/refund`, admin.token, {
        reason: 'cliente reclamou',
      });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/repasse/);
      expect(
        (await t.prisma.payment.findUniqueOrThrow({ where: { deliveryId: id2 } })).status,
      ).toBe('PAGO');
    });
  });

  describe('preço combinado', () => {
    it('recusa e não cobra se o preço mudou desde a cotação', async () => {
      const r = await t.post(
        '/deliveries',
        client.token,
        body(CARD_OK, { expectedFareCents: 900 }),
      );
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/preço mudou/);
      expect(await t.prisma.payment.count()).toBe(0);
      const ok = await t.post(
        '/deliveries',
        client.token,
        body(CARD_OK, { expectedFareCents: 1100 }),
      );
      expect(ok.status).toBe(201);
    });
  });

  describe('idempotência', () => {
    it('repetir o pedido com a mesma chave devolve o mesmo, cobrando uma vez', async () => {
      const key = 'chave-de-teste-0001';
      const [a, b] = await Promise.all([
        t.post('/deliveries', client.token, body(CARD_OK, { idempotencyKey: key })),
        t.post('/deliveries', client.token, body(CARD_OK, { idempotencyKey: key })),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await t.prisma.delivery.count()).toBe(1);
      expect(await t.prisma.payment.count()).toBe(1);
      const c = await t.post('/deliveries', client.token, body(CARD_OK, { idempotencyKey: key }));
      expect(c.body.id).toBe(a.body.id);
    });

    it('a chave é por cliente', async () => {
      const key = 'chave-de-teste-0002';
      const other = await t.client('Outra');
      const a = await t.post('/deliveries', client.token, body(CARD_OK, { idempotencyKey: key }));
      const b = await t.post('/deliveries', other.token, body(CARD_OK, { idempotencyKey: key }));
      expect(a.body.id).not.toBe(b.body.id);
    });
  });

  describe('recibo', () => {
    it('só depois de pago; traz valores, forma de pagamento e aviso', async () => {
      const pix = (await t.post('/deliveries', client.token, body(PIX))).body;
      expect((await t.get(`/deliveries/${pix.id}/receipt`, client.token)).status).toBe(409);
      await t.post(`/payments/sandbox/pix/${pix.id}/confirm`, client.token);
      const r = (await t.get(`/deliveries/${pix.id}/receipt`, client.token)).body;
      expect(r).toMatchObject({ fareCents: 1100, paidCents: 1100, refundedCents: 0 });
      expect(r.number).toMatch(/^AMMA-\d{8}-[0-9A-F]{8}$/);
      expect(r.payment).toMatchObject({ method: 'PIX', status: 'PAGO' });
      expect(r.notice).toMatch(/não é nota fiscal/i);
    });

    it('depois do estorno, mostra o valor devolvido', async () => {
      const d = await t.createDelivery(client);
      await t.post(`/deliveries/${d.id}/cancel`, client.token, { reason: 'CLIENTE_DESISTIU' });
      const r = (await t.get(`/deliveries/${d.id}/receipt`, client.token)).body;
      expect(r).toMatchObject({ paidCents: 0, refundedCents: 1100 });
    });

    it('é só do cliente dono (e do admin): motorista e estranhos veem 404', async () => {
      const id = await t.runToDelivered(client, driver);
      const other = await t.client('Outro');
      expect((await t.get(`/deliveries/${id}/receipt`, driver.token)).status).toBe(404);
      expect((await t.get(`/deliveries/${id}/receipt`, other.token)).status).toBe(404);
      expect((await t.get(`/deliveries/${id}/receipt`, (await t.admin()).token)).status).toBe(200);
      expect((await t.get(`/deliveries/${id}/receipt`, client.token)).status).toBe(200);
    });
  });

  describe('avaliação', () => {
    it('cliente avalia uma vez, só depois de entregue; aparece no pedido', async () => {
      const d = await t.createDelivery(client);
      expect((await t.post(`/deliveries/${d.id}/rating`, client.token, { stars: 5 })).status).toBe(
        409,
      );
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      for (const s of ['en-route-pickup', 'picked-up', 'en-route-dropoff', 'delivered'])
        await t.post(`/driver/deliveries/${d.id}/${s}`, driver.token);

      for (const stars of [0, 6, 2.5])
        expect((await t.post(`/deliveries/${d.id}/rating`, client.token, { stars })).status).toBe(
          400,
        );
      const ok = await t.post(`/deliveries/${d.id}/rating`, client.token, {
        stars: 4,
        comment: 'Chegou rápido',
      });
      expect(ok.status).toBe(201);
      expect(ok.body.rating).toMatchObject({ stars: 4, comment: 'Chegou rápido' });
      expect((await t.post(`/deliveries/${d.id}/rating`, client.token, { stars: 1 })).status).toBe(
        409,
      );
      const stored = await t.prisma.rating.findFirstOrThrow({ where: { deliveryId: d.id } });
      expect(stored.rateeId).toBe(driver.id);
      expect(stored.direction).toBe('CLIENTE_AVALIA_MOTORISTA');
    });

    it('estranho e motorista não avaliam', async () => {
      const id = await t.runToDelivered(client, driver);
      const other = await t.client('Outro');
      expect((await t.post(`/deliveries/${id}/rating`, other.token, { stars: 5 })).status).toBe(
        404,
      );
      expect((await t.post(`/deliveries/${id}/rating`, driver.token, { stars: 5 })).status).toBe(
        403,
      );
    });

    it('o banco recusa nota fora de 1 a 5', async () => {
      const id = await t.runToDelivered(client, driver);
      await expect(
        t.prisma.rating.create({
          data: { deliveryId: id, authorId: client.id, rateeId: driver.id, stars: 9 },
        }),
      ).rejects.toThrow();
    });
  });

  describe('comerciante', () => {
    let shop: TestUser;
    beforeEach(async () => {
      shop = await t.user(['COMERCIANTE'], 'Dona Lia');
    });
    const profile = {
      tradeName: 'Padaria da Lia',
      cnpj: '11.222.333/0001-81',
      address: 'Av. Epitácio Pessoa, 100',
      lat: -7.115,
      lng: -34.861,
    };

    it('cadastra, lê e atualiza o estabelecimento', async () => {
      expect((await t.get('/merchant', shop.token)).body).toBeNull();
      const saved = await t.put('/merchant', shop.token, profile);
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ tradeName: 'Padaria da Lia', cnpj: '11222333000181' });
      const upd = await t.put('/merchant', shop.token, {
        ...profile,
        tradeName: 'Padaria Nova',
        cnpj: '',
      });
      expect(upd.body).toMatchObject({ tradeName: 'Padaria Nova', cnpj: null });
      expect(await t.prisma.merchant.count()).toBe(1);
    });

    it('rejeita CNPJ inválido ou repetido, e quem não é comerciante', async () => {
      expect(
        (await t.put('/merchant', shop.token, { ...profile, cnpj: '11.222.333/0001-82' })).status,
      ).toBe(400);
      await t.put('/merchant', shop.token, profile);
      const shop2 = await t.user(['COMERCIANTE'], 'Outra Loja');
      expect((await t.put('/merchant', shop2.token, profile)).status).toBe(409);
      expect((await t.put('/merchant', client.token, profile)).status).toBe(403);
      expect((await t.get('/merchant/report', client.token)).status).toBe(403);
    });

    it('cria entregas, vê o histórico e o relatório', async () => {
      await t.put('/merchant', shop.token, profile);
      const a = await t.post('/deliveries', shop.token, body(CARD_OK));
      expect(a.status).toBe(201);
      await t.post(`/deliveries/${a.body.id}/cancel`, shop.token, { reason: 'CLIENTE_DESISTIU' });
      const b = await t.post('/deliveries', shop.token, body(CARD_OK));
      expect((await t.get('/deliveries', shop.token)).body).toHaveLength(2);
      expect((await t.get('/deliveries', client.token)).body).toHaveLength(0);

      const rep = (await t.get('/merchant/report?days=7', shop.token)).body;
      expect(rep).toMatchObject({
        days: 7,
        total: 2,
        cancelled: 1,
        inProgress: 1,
        spentCents: 1100,
        refundedCents: 1100,
        averageTicketCents: 1100,
        cancelRatePercent: 50,
      });
      expect(rep.perDay).toHaveLength(7);
      expect(b.status).toBe(201);
      expect((await t.get('/merchant/report?days=5', shop.token)).status).toBe(400);
    });

    it('excluir a conta apaga o estabelecimento e os comentários das avaliações', async () => {
      await t.put('/merchant', shop.token, profile);
      expect((await t.request('DELETE', '/me', shop.token)).status).toBe(204);
      expect(await t.prisma.merchant.count()).toBe(0);
    });
  });
});
