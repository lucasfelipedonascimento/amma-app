import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CARD_OK, DROPOFF, PICKUP, TestApp, near, type TestUser } from './helpers';

describe('despacho', () => {
  let t: TestApp;
  let client: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    client = await t.client();
  });

  const offerTo = async (drivers: TestUser[]) => {
    const found: TestUser[] = [];
    for (const d of drivers) if (await t.currentOffer(d)) found.push(d);
    return found;
  };

  describe('quem recebe a oferta', () => {
    it('o motorista mais próximo, um por vez', async () => {
      const far = await t.driver('Longe');
      const mid = await t.driver('Meio');
      const close = await t.driver('Perto');
      await t.online(far, near(2000));
      await t.online(close, near(150));
      await t.online(mid, near(900));

      await t.createDelivery(client);
      expect(await offerTo([far, mid, close])).toEqual([close]);
    });

    it('registra a decisão com o motivo, a distância e os descartados', async () => {
      const a = await t.driver('A');
      const busy = await t.driver('B');
      await t.online(a, near(400));
      await t.online(busy, near(100));
      // "busy" já está com outra entrega
      const other = await t.client();
      await t.createDelivery(other); // vai para "busy" (mais perto)
      await t.post(`/driver/offers/${(await t.currentOffer(busy)).id}/accept`, busy.token);

      const d = await t.createDelivery(client);
      expect(await offerTo([a, busy])).toEqual([a]);
      const ev = (await t.events(d.id)).find((e) => e.type === 'OFERTA')!;
      expect(ev).toMatchObject({ reason: 'OFERTA_MAIS_PROXIMO', actorId: a.id });
      expect(ev.data).toMatchObject({
        distanceMeters: expect.any(Number),
        rank: 1,
        eligible: 1,
        inRadius: 2,
        excluded: { OCUPADO: 1 },
        radiusMeters: 3000,
      });
      expect((ev.data as any).distanceMeters).toBeGreaterThan(380);
      expect((ev.data as any).distanceMeters).toBeLessThan(420);
    });

    it('ignora quem está fora do raio, offline, sem aprovação ou com posição antiga', async () => {
      const outside = await t.driver('Fora');
      const offline = await t.driver('Offline');
      const pending = await t.driver('Pendente', { approved: false });
      const stale = await t.driver('Antigo');
      const ok = await t.driver('Ok');
      await t.online(outside, near(3500));
      await t.online(offline, near(100));
      await t.post('/driver/presence/offline', offline.token);
      await t.online(stale, near(100));
      await t.prisma
        .$executeRaw`UPDATE "DriverPresence" SET "locationAt" = now() - interval '5 minutes' WHERE "userId" = ${stale.id}`;
      await t.online(ok, near(2500));
      // Motorista não aprovado nem consegue ficar online...
      await t.consentLocation(pending.id);
      const r = await t.post('/driver/presence/online', pending.token, near(50));
      expect(r.status).toBe(403);
      expect(r.body.approval.status).toBe('PENDENTE');
      // ...e, se um documento for reprovado depois de online, deixa de receber oferta.
      const revoked = await t.driver('Revogado');
      await t.online(revoked, near(60));
      await t.prisma.document.updateMany({
        where: { userId: revoked.id, type: 'CNH' },
        data: { status: 'REPROVADO' },
      });

      const d = await t.createDelivery(client);
      expect(await offerTo([outside, offline, pending, stale, ok, revoked])).toEqual([ok]);
      const ev = (await t.events(d.id)).find((e) => e.type === 'OFERTA')!;
      expect(ev.data).toMatchObject({ excluded: { POSICAO_ANTIGA: 1, NAO_APROVADO: 1 } });
    });

    it('empate de distância: quem está online há mais tempo', async () => {
      const newer = await t.driver('Novo');
      const older = await t.driver('Antigo');
      await t.online(newer, near(500));
      await t.online(older, near(500));
      await t.prisma.driverPresence.update({
        where: { userId: older.id },
        data: { onlineSince: new Date(Date.now() - 3_600_000) },
      });
      await t.createDelivery(client);
      expect(await offerTo([newer, older])).toEqual([older]);
    });

    it('sem candidatos: fica em CRIADO, registra uma vez, e oferece quando alguém entra', async () => {
      const d = await t.createDelivery(client);
      expect(d.status).toBe('CRIADO');
      await t.dispatch.tick();
      await t.dispatch.tick();
      const logged = (await t.events(d.id)).filter((e) => e.type === 'SEM_CANDIDATOS');
      expect(logged).toHaveLength(1); // não enche o log a cada rodada
      expect(logged[0].reason).toBe('SEM_CANDIDATOS');

      const late = await t.driver('Chegou');
      await t.online(late, near(500));
      await t.dispatch.tick();
      expect((await t.get(`/deliveries/${d.id}`, client.token)).body.status).toBe('OFERECIDO');
      expect(await offerTo([late])).toEqual([late]);
    });
  });

  describe('recusa e expiração', () => {
    it('recusar passa ao próximo e NÃO pune: o motorista segue primeiro na fila dos próximos pedidos', async () => {
      const first = await t.driver('Primeiro');
      const second = await t.driver('Segundo');
      await t.online(first, near(200));
      await t.online(second, near(800));

      const d1 = await t.createDelivery(client);
      const offer1 = await t.currentOffer(first);
      const declined = await t.post(`/driver/offers/${offer1.id}/decline`, first.token, {
        reason: 'VALOR_BAIXO',
      });
      expect(declined.status).toBe(204);
      // Imediatamente vai para o segundo
      expect(await offerTo([first, second])).toEqual([second]);
      expect((await t.get(`/deliveries/${d1.id}`, client.token)).body.status).toBe('OFERECIDO');

      const ev = (await t.events(d1.id)).find((e) => e.type === 'RECUSA')!;
      expect(ev).toMatchObject({ reason: 'RECUSOU', actorId: first.id });
      expect(ev.data).toMatchObject({ declineReason: 'VALOR_BAIXO' });

      // Segundo aceita; o primeiro continua online e elegível...
      await t.post(`/driver/offers/${(await t.currentOffer(second)).id}/accept`, second.token);
      expect((await t.get('/driver/presence', first.token)).body.online).toBe(true);
      // ...e é de novo o primeiro escolhido num pedido novo
      await t.createDelivery(await t.client());
      expect(await offerTo([first, second])).toEqual([first]);
    });

    it('o mesmo pedido não volta a quem recusou; só há registro desta oferta', async () => {
      const only = await t.driver('Unico');
      await t.online(only, near(200));
      const d = await t.createDelivery(client);
      await t.post(`/driver/offers/${(await t.currentOffer(only)).id}/decline`, only.token);
      await t.dispatch.tick();
      expect(await t.currentOffer(only)).toBeNull();
      expect((await t.get(`/deliveries/${d.id}`, client.token)).body.status).toBe('CRIADO');
      const ev = (await t.events(d.id)).find((e) => e.type === 'SEM_CANDIDATOS')!;
      expect(ev.data).toMatchObject({ excluded: { JA_TENTADO: 1 } });
    });

    it('não responder expira a oferta e passa ao próximo', async () => {
      const first = await t.driver('Primeiro');
      const second = await t.driver('Segundo');
      await t.online(first, near(200));
      await t.online(second, near(800));
      const d = await t.createDelivery(client);
      expect(await offerTo([first])).toEqual([first]);

      await t.expireOffers();
      // Aceitar depois do prazo falha
      const late = await t.post(
        `/driver/offers/${(await t.prisma.deliveryOffer.findFirstOrThrow()).id}/accept`,
        first.token,
      );
      expect(late.status).toBe(409);
      await t.dispatch.tick();

      expect(await offerTo([first, second])).toEqual([second]);
      const types = (await t.events(d.id)).filter((e) => e.type === 'EXPIRACAO');
      expect(types).toHaveLength(1);
      expect(types[0]).toMatchObject({ reason: 'EXPIROU', actorId: first.id });
      const offers = await t.prisma.deliveryOffer.findMany({ orderBy: { createdAt: 'asc' } });
      expect(offers.map((o) => o.status)).toEqual(['EXPIRADA', 'PENDENTE']);
    });

    it('esgotada a janela de busca, cancela com SEM_MOTORISTA', async () => {
      const d = await t.createDelivery(client);
      await t.dispatch.tick();
      expect((await t.get(`/deliveries/${d.id}`, client.token)).body.status).toBe('CRIADO');
      await t.prisma.delivery.update({
        where: { id: d.id },
        data: { createdAt: new Date(Date.now() - 301_000) },
      });
      // A janela de busca conta do pagamento: o cartão foi cobrado na hora do pedido.
      await t.prisma.payment.update({
        where: { deliveryId: d.id },
        data: { paidAt: new Date(Date.now() - 301_000) },
      });
      await t.dispatch.tick();
      const after = (await t.get(`/deliveries/${d.id}`, client.token)).body;
      expect(after).toMatchObject({ status: 'CANCELADO', cancelReason: 'SEM_MOTORISTA' });
      const reasons = (await t.events(d.id)).map((e) => e.reason);
      expect(reasons).toContain('JANELA_ESGOTADA');
    });

    it('motorista que fica offline com oferta pendente: vai ao próximo, sem punição', async () => {
      const first = await t.driver('Primeiro');
      const second = await t.driver('Segundo');
      await t.online(first, near(200));
      await t.online(second, near(800));
      const d = await t.createDelivery(client);
      expect(await offerTo([first])).toEqual([first]);
      expect((await t.post('/driver/presence/offline', first.token)).status).toBe(200);
      expect(await offerTo([first, second])).toEqual([second]);
      expect((await t.events(d.id)).find((e) => e.type === 'EXPIRACAO')!.reason).toBe(
        'FICOU_OFFLINE',
      );
    });
  });

  describe('concorrência', () => {
    it('duas aceitações simultâneas da mesma oferta: só uma vence', async () => {
      const driver = await t.driver();
      await t.online(driver, near(200));
      await t.createDelivery(client);
      const offer = await t.currentOffer(driver);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => t.post(`/driver/offers/${offer.id}/accept`, driver.token)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await t.prisma.deliveryEvent.count({ where: { type: 'ACEITE' } })).toBe(1);
    });

    it('um motorista nunca recebe duas ofertas ao mesmo tempo', async () => {
      const driver = await t.driver();
      await t.online(driver, near(200));
      const clients = await Promise.all(Array.from({ length: 6 }, () => t.client()));
      await Promise.all(
        clients.map((c) =>
          t.post('/deliveries', c.token, { pickup: PICKUP, dropoff: DROPOFF, payment: CARD_OK }),
        ),
      );
      await t.dispatch.tick();
      expect(await t.prisma.deliveryOffer.count({ where: { status: 'PENDENTE' } })).toBe(1);
      expect(await t.prisma.delivery.count({ where: { status: 'OFERECIDO' } })).toBe(1);
      expect(await t.prisma.delivery.count({ where: { status: 'CRIADO' } })).toBe(5);
    });

    it('rodadas simultâneas de tick não duplicam ofertas', async () => {
      const a = await t.driver('A');
      const b = await t.driver('B');
      await t.online(a, near(200));
      await t.online(b, near(300));
      const d = await t.createDelivery(client);
      await t.expireOffers();
      await Promise.all([t.dispatch.tick(), t.dispatch.tick(), t.dispatch.tick()]);
      expect(
        await t.prisma.deliveryOffer.count({ where: { deliveryId: d.id, status: 'PENDENTE' } }),
      ).toBe(1);
    });
  });

  describe('cancelamento e desistência', () => {
    it('cliente cancela com oferta pendente: a oferta é encerrada', async () => {
      const driver = await t.driver();
      await t.online(driver, near(200));
      const d = await t.createDelivery(client);
      const offer = await t.currentOffer(driver);
      const r = await t.post(`/deliveries/${d.id}/cancel`, client.token, {
        reason: 'CLIENTE_DESISTIU',
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'CANCELADO', cancelReason: 'CLIENTE_DESISTIU' });
      expect(await t.currentOffer(driver)).toBeNull();
      expect((await t.post(`/driver/offers/${offer.id}/accept`, driver.token)).status).toBe(409);
    });

    it('cliente não cancela depois de coletado; motorista cancela por entrega impossível', async () => {
      const driver = await t.driver();
      await t.online(driver, near(200));
      const d = await t.createDelivery(client);
      await t.post(`/driver/offers/${(await t.currentOffer(driver)).id}/accept`, driver.token);
      for (const s of ['en-route-pickup', 'picked-up'])
        await t.post(`/driver/deliveries/${d.id}/${s}`, driver.token);

      const byClient = await t.post(`/deliveries/${d.id}/cancel`, client.token, {
        reason: 'CLIENTE_DESISTIU',
      });
      expect(byClient.status).toBe(409);
      // motivo de outro ator
      expect(
        (await t.post(`/deliveries/${d.id}/cancel`, client.token, { reason: 'ENTREGA_IMPOSSIVEL' }))
          .status,
      ).toBe(403);
      expect(
        (await t.post(`/deliveries/${d.id}/cancel`, driver.token, { reason: 'COLETA_IMPOSSIVEL' }))
          .status,
      ).toBe(409);
      expect(
        (await t.post(`/deliveries/${d.id}/cancel`, client.token, { reason: 'SEM_MOTORISTA' }))
          .status,
      ).toBe(403);

      const ok = await t.post(`/deliveries/${d.id}/cancel`, driver.token, {
        reason: 'ENTREGA_IMPOSSIVEL',
        note: 'Ausente',
      });
      expect(ok.body).toMatchObject({ status: 'CANCELADO', cancelReason: 'ENTREGA_IMPOSSIVEL' });
      // Cancelado não gera ledger
      expect(await t.prisma.ledgerTransaction.count()).toBe(0);
      // E o motorista fica livre para outro pedido
      await t.createDelivery(await t.client());
      expect(await t.currentOffer(driver)).not.toBeNull();
    });

    it('admin cancela qualquer não final, mas precisa justificar', async () => {
      const admin = await t.admin();
      const d = await t.createDelivery(client);
      const noNote = await t.post(`/deliveries/${d.id}/cancel`, admin.token, {
        reason: 'ADMIN_CANCELOU',
      });
      expect(noNote.status).toBe(400);
      const ok = await t.post(`/deliveries/${d.id}/cancel`, admin.token, {
        reason: 'ADMIN_CANCELOU',
        note: 'Fraude',
      });
      expect(ok.body.status).toBe('CANCELADO');
      expect(
        (
          await t.post(`/deliveries/${d.id}/cancel`, admin.token, {
            reason: 'ADMIN_CANCELOU',
            note: 'x',
          })
        ).status,
      ).toBe(409);
      // O registro completo é só do admin
      expect((await t.get(`/admin/deliveries/${d.id}/events`, admin.token)).status).toBe(200);
      expect((await t.get(`/admin/deliveries/${d.id}/events`, client.token)).status).toBe(403);
    });

    it('motorista que desiste antes de coletar devolve o pedido à fila e não o recebe de volta', async () => {
      const first = await t.driver('Primeiro');
      const second = await t.driver('Segundo');
      await t.online(first, near(200));
      await t.online(second, near(800));
      const d = await t.createDelivery(client);
      await t.post(`/driver/offers/${(await t.currentOffer(first)).id}/accept`, first.token);

      const rel = await t.post(`/driver/deliveries/${d.id}/release`, first.token);
      expect(rel.status).toBe(204);
      expect(await offerTo([first, second])).toEqual([second]);
      const row = await t.prisma.delivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.workerId).toBeNull();
      expect(
        (await t.events(d.id)).some((e) => e.type === 'DESISTENCIA' && e.reason === 'DESISTIU'),
      ).toBe(true);
      // Depois de coletar não dá mais para liberar
      await t.post(`/driver/offers/${(await t.currentOffer(second)).id}/accept`, second.token);
      await t.post(`/driver/deliveries/${d.id}/en-route-pickup`, second.token);
      await t.post(`/driver/deliveries/${d.id}/picked-up`, second.token);
      expect((await t.post(`/driver/deliveries/${d.id}/release`, second.token)).status).toBe(409);
    });

    it('não fica offline com entrega em andamento', async () => {
      const driver = await t.driver();
      await t.online(driver, near(200));
      await t.createDelivery(client);
      await t.post(`/driver/offers/${(await t.currentOffer(driver)).id}/accept`, driver.token);
      expect((await t.post('/driver/presence/offline', driver.token)).status).toBe(409);
    });
  });

  describe('ofertas de outros', () => {
    it('motorista não vê nem responde oferta de outro', async () => {
      const a = await t.driver('A');
      const b = await t.driver('B');
      await t.online(a, near(200));
      await t.createDelivery(client);
      const offer = await t.currentOffer(a);
      expect((await t.post(`/driver/offers/${offer.id}/accept`, b.token)).status).toBe(404);
      expect((await t.post(`/driver/offers/${offer.id}/decline`, b.token, {})).status).toBe(404);
      expect(await t.currentOffer(b)).toBeNull();
    });
  });

  describe('configuração e regras públicas', () => {
    it('GET /dispatch/rules é público e lista regras, motivos e parâmetros', async () => {
      const r = await t.get('/dispatch/rules');
      expect(r.status).toBe(200);
      expect(r.body.rules.length).toBeGreaterThan(5);
      expect(r.body.reasons.RECUSOU).toMatch(/não gera punição/i);
      expect(r.body.config).toEqual({
        radiusMeters: 3000,
        offerTtlSeconds: 30,
        maxSearchSeconds: 300,
        maxPositionAgeSeconds: 60,
      });
    });

    it('o admin muda o raio e o prazo, e isso vale na hora', async () => {
      const admin = await t.admin();
      const driver = await t.driver();
      await t.online(driver, near(1500));
      const bad = await t.put('/admin/dispatch-settings', admin.token, {
        radiusMeters: 10,
        offerTtlSeconds: 30,
        maxSearchSeconds: 300,
        maxPositionAgeSeconds: 60,
      });
      expect(bad.status).toBe(400);
      const ok = await t.put('/admin/dispatch-settings', admin.token, {
        radiusMeters: 1000,
        offerTtlSeconds: 10,
        maxSearchSeconds: 120,
        maxPositionAgeSeconds: 60,
      });
      expect(ok.status).toBe(200);
      expect((await t.get('/dispatch/rules')).body.config.radiusMeters).toBe(1000);

      const d = await t.createDelivery(client);
      expect(d.status).toBe('CRIADO'); // 1,5 km > novo raio de 1 km
      await t.put('/admin/dispatch-settings', admin.token, {
        radiusMeters: 2000,
        offerTtlSeconds: 10,
        maxSearchSeconds: 120,
        maxPositionAgeSeconds: 60,
      });
      await t.dispatch.tick();
      const offer = await t.prisma.deliveryOffer.findFirstOrThrow();
      expect(offer.expiresAt.getTime() - offer.createdAt.getTime()).toBeLessThanOrEqual(10_500);
      expect(offer.expiresAt.getTime() - offer.createdAt.getTime()).toBeGreaterThan(9_000);
    });
  });
});
