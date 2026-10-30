import { HOUSE_CHECKLIST, MAX_COMPLETION_DISTANCE_METERS } from '@amma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PositionStore } from '../src/presence/position-store';
import { DROPOFF, PICKUP, TestApp, near, type TestUser } from './helpers';

const UUID = '00000000-0000-4000-8000-000000000000';
const CHECKLIST = Object.fromEntries(HOUSE_CHECKLIST.map((i) => [i.key, true]));
/** Ponto a `meters` ao norte do destino (0,001° de latitude ≈ 111 m). */
const nearDropoff = (meters: number) => ({ lat: DROPOFF.lat + meters / 111_000, lng: DROPOFF.lng });

describe('autorização e fraude (Parte 2 da auditoria)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  // ------------------------------------------------------------------ presença na conclusão
  describe('conclusão só perto do destino (300 m)', () => {
    let client: TestUser;
    let driver: TestUser;
    let id: string;

    /** Pedido aceito e em "a caminho da entrega", com o motorista ainda na coleta. */
    beforeEach(async () => {
      client = await t.client();
      driver = await t.driver('Maria');
      await t.online(driver, near(100));
      const d = await t.createDelivery(client);
      id = d.id;
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      for (const step of ['en-route-pickup', 'picked-up', 'en-route-dropoff'])
        expect((await t.post(`/driver/deliveries/${id}/${step}`, driver.token)).status).toBe(200);
    });

    const deliver = () => t.post(`/driver/deliveries/${id}/delivered`, driver.token);
    const status = async () => (await t.get(`/deliveries/${id}`, client.token)).body.status;
    const settlements = () => t.prisma.ledgerTransaction.count({ where: { reference: id } });

    it('longe do destino: 409 TOO_FAR_FROM_DROPOFF, nada muda e nada vai ao ledger', async () => {
      const r = await deliver(); // o motorista ainda está na coleta, ~2 km do destino
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('TOO_FAR_FROM_DROPOFF');
      expect(r.body.distanceMeters).toBeGreaterThan(MAX_COMPLETION_DISTANCE_METERS);
      expect(await status()).toBe('A_CAMINHO_ENTREGA');
      expect(await settlements()).toBe(0);
    });

    it('o limite é 300 m: 250 m conclui, 350 m não', async () => {
      await t.post('/driver/position', driver.token, nearDropoff(350));
      expect((await deliver()).status).toBe(409);
      await new Promise((r) => setTimeout(r, 1100)); // a API descarta posições com menos de 1 s de intervalo
      await t.post('/driver/position', driver.token, nearDropoff(250));
      expect((await deliver()).status).toBe(200);
      expect(await status()).toBe('ENTREGUE');
      expect(await settlements()).toBe(1);
    });

    it('posição enviada no corpo da conclusão é ignorada (vale a que o servidor recebeu)', async () => {
      const r = await t.post(`/driver/deliveries/${id}/delivered`, driver.token, {
        lat: DROPOFF.lat,
        lng: DROPOFF.lng,
      });
      expect(r.status).toBe(409);
      expect(await status()).toBe('A_CAMINHO_ENTREGA');
    });

    it('sem posição conhecida: 409 POSITION_UNKNOWN', async () => {
      await t.app.get(PositionStore).remove(driver.id);
      await t.prisma
        .$executeRaw`UPDATE "DriverPresence" SET location = NULL, "locationAt" = NULL WHERE "userId" = ${driver.id}`;
      const r = await deliver();
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('POSITION_UNKNOWN');
    });

    it('posição velha (mais de 2 min) não vale, mesmo estando no destino', async () => {
      await t.app.get(PositionStore).set(driver.id, {
        ...nearDropoff(10),
        at: new Date(Date.now() - 5 * 60_000).toISOString(),
      });
      const r = await deliver();
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('POSITION_UNKNOWN');
    });

    it('sem Redis, vale a última posição gravada no PostGIS', async () => {
      await t.app.get(PositionStore).remove(driver.id);
      await t.prisma.$executeRaw`
        UPDATE "DriverPresence"
        SET location = ST_SetSRID(ST_MakePoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
            "locationAt" = now()
        WHERE "userId" = ${driver.id}`;
      expect((await deliver()).status).toBe(200);
    });

    it('conclusões simultâneas e repetidas: um fechamento só no ledger', async () => {
      await t.atDropoff(driver);
      const rs = await Promise.all(Array.from({ length: 6 }, deliver));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
      expect(await settlements()).toBe(1);
    });

    it('sem conseguir chegar, o motorista sai pelo cancelamento ENTREGA_IMPOSSIVEL', async () => {
      const r = await t.post(`/deliveries/${id}/cancel`, driver.token, {
        reason: 'ENTREGA_IMPOSSIVEL',
      });
      expect(r.status).toBe(200);
    });
  });

  it('corrida de passageiro segue a mesma regra de presença no destino', async () => {
    const client = await t.client();
    const driver = await t.carDriver();
    await t.online(driver, near(100));
    const ride = await t.createRide(client);
    const offer = await t.currentOffer(driver);
    await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    await t.post(`/driver/deliveries/${ride.id}/en-route-pickup`, driver.token);
    await t.post(`/driver/deliveries/${ride.id}/picked-up`, driver.token, {
      pin: ride.boardingPin,
    });
    await t.post(`/driver/deliveries/${ride.id}/en-route-dropoff`, driver.token);
    const far = await t.post(`/driver/deliveries/${ride.id}/delivered`, driver.token);
    expect(far.body.code).toBe('TOO_FAR_FROM_DROPOFF');
    await t.atDropoff(driver);
    expect((await t.post(`/driver/deliveries/${ride.id}/delivered`, driver.token)).status).toBe(
      200,
    );
  });

  // ------------------------------------------------------------------ auto-atendimento
  describe('ninguém atende o próprio pedido', () => {
    it('quem é passageiro e motorista não recebe a oferta do próprio pedido', async () => {
      const both = await t.driver('Os dois');
      await t.prisma.user.update({
        where: { id: both.id },
        data: { roles: ['PASSAGEIRO', 'MOTORISTA'] },
      });
      await t.online(both, near(50));
      const d = await t.createDelivery(both);
      expect((await t.get('/driver/offers/current', both.token)).body?.id).toBeUndefined();
      expect((await t.get(`/deliveries/${d.id}`, both.token)).body.status).toBe('CRIADO');
      // Outro motorista, sim, recebe.
      const other = await t.driver('Outro');
      await t.online(other, near(60));
      await t.dispatch.tick();
      await t.dispatch.dispatch(d.id);
      expect((await t.currentOffer(other))?.deliveryId).toBe(d.id);
    });

    it('mesmo com uma oferta forjada no banco, o aceite do próprio pedido é recusado', async () => {
      const both = await t.driver('Os dois');
      await t.prisma.user.update({
        where: { id: both.id },
        data: { roles: ['PASSAGEIRO', 'MOTORISTA'] },
      });
      const d = await t.createDelivery(both);
      await t.prisma.delivery.update({ where: { id: d.id }, data: { status: 'OFERECIDO' } });
      const offer = await t.prisma.deliveryOffer.create({
        data: {
          deliveryId: d.id,
          driverId: both.id,
          distanceMeters: 10,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const r = await t.post(`/driver/offers/${offer.id}/accept`, both.token);
      expect(r.status).toBe(409);
      expect(
        (await t.prisma.delivery.findUniqueOrThrow({ where: { id: d.id } })).workerId,
      ).toBeNull();
    });
  });

  // ------------------------------------------------------------------ matriz IDOR / BOLA
  describe('um usuário não alcança recurso de outro (IDOR/BOLA)', () => {
    let owner: TestUser; // dono do pedido
    let driverA: TestUser; // motorista do pedido
    let intruder: TestUser; // outro passageiro/comerciante
    let driverB: TestUser; // outro motorista
    let delivery: string;
    let ride: string;
    let offerForA: string;

    beforeEach(async () => {
      owner = await t.client('Dono');
      intruder = await t.client('Intruso');
      driverA = await t.driver('Motorista A');
      driverB = await t.driver('Motorista B');
      await t.online(driverA, near(50));
      delivery = (await t.createDelivery(owner)).id;
      offerForA = (await t.currentOffer(driverA)).id;
      await t.post(`/driver/offers/${offerForA}/accept`, driverA.token);
      await t.post(`/driver/deliveries/${delivery}/en-route-pickup`, driverA.token);
      // Corrida com motorista de carro.
      const car = await t.carDriver('Carro');
      await t.online(car, near(70));
      ride = (await t.createRide(owner)).id;
      const o = await t.currentOffer(car);
      await t.post(`/driver/offers/${o.id}/accept`, car.token);
    });

    const notAllowed = (status: number) => [401, 403, 404].includes(status);

    it('pedido de outra pessoa: leitura, recibo, avaliação, cancelamento e Pix → 403/404', async () => {
      const calls: [string, string, TestUser, object?][] = [
        ['GET', `/deliveries/${delivery}`, intruder],
        ['GET', `/deliveries/${delivery}`, driverB],
        ['GET', `/deliveries/${delivery}/receipt`, intruder],
        ['GET', `/deliveries/${delivery}/receipt`, driverA], // motorista não vê recibo/pagamento
        ['POST', `/deliveries/${delivery}/rating`, intruder, { stars: 1 }],
        ['POST', `/deliveries/${delivery}/cancel`, intruder, { reason: 'CLIENTE_DESISTIU' }],
        ['POST', `/deliveries/${delivery}/cancel`, driverB, { reason: 'COLETA_IMPOSSIVEL' }],
        ['POST', `/payments/sandbox/pix/${delivery}/confirm`, intruder],
      ];
      for (const [m, path, u, body] of calls) {
        const r = await t.req(m, path, u.token, body);
        expect(notAllowed(r.status), `${m} ${path} → ${r.status}`).toBe(true);
      }
    });

    it('lista de pedidos é só a do próprio usuário', async () => {
      const mine = await t.get('/deliveries', owner.token);
      expect(mine.body.some((d: { id: string }) => d.id === delivery)).toBe(true);
      const theirs = await t.get('/deliveries', intruder.token);
      expect(theirs.body).toEqual([]);
    });

    it('passos do motorista em pedido de outro motorista → 404', async () => {
      for (const step of [
        'en-route-pickup',
        'picked-up',
        'en-route-dropoff',
        'delivered',
        'release',
      ]) {
        const r = await t.post(`/driver/deliveries/${delivery}/${step}`, driverB.token);
        expect(r.status, step).toBe(404);
      }
      expect(
        (await t.get(`/driver/deliveries/${delivery}/route?lat=-7.1&lng=-34.8`, driverB.token))
          .status,
      ).toBe(404);
      expect(
        (await t.post(`/driver/deliveries/${delivery}/rating`, driverB.token, { stars: 5 })).status,
      ).toBe(404);
    });

    it('oferta de outro motorista: aceitar e recusar → 404', async () => {
      expect((await t.post(`/driver/offers/${offerForA}/accept`, driverB.token)).status).toBe(404);
      expect((await t.post(`/driver/offers/${offerForA}/decline`, driverB.token, {})).status).toBe(
        404,
      );
    });

    it('corrida: foto, compartilhar, registro e links de outro passageiro → 404', async () => {
      const calls: [string, string, TestUser, object?][] = [
        ['GET', `/rides/${ride}/driver-photo`, intruder],
        ['POST', `/rides/${ride}/shares`, intruder, {}],
        ['GET', `/rides/${ride}/shares`, intruder],
        ['GET', `/rides/${ride}/record`, intruder],
        ['DELETE', `/rides/${ride}/shares/${UUID}`, intruder],
        [
          'POST',
          '/safety/reports',
          intruder,
          { deliveryId: ride, category: 'OUTRO', description: 'x'.repeat(20) },
        ],
        ['POST', '/safety/emergency', intruder, { deliveryId: ride }],
      ];
      for (const [m, path, u, body] of calls) {
        const r = await t.req(m, path, u.token, body);
        expect(notAllowed(r.status), `${m} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(
          true,
        );
      }
    });

    it('motorista não usa rotas de passageiro, e passageiro não usa as de motorista', async () => {
      expect(notAllowed((await t.get(`/rides/${ride}/record`, driverB.token)).status)).toBe(true);
      expect((await t.get('/driver/wallet', owner.token)).status).toBe(403);
      expect((await t.get('/driver/offers/current', owner.token)).status).toBe(403);
      expect((await t.get('/merchant', owner.token)).status).toBe(403);
    });

    it('rotas /admin e /panel recusam quem não é admin, em todos os papéis', async () => {
      const paths: [string, string][] = [
        ['GET', `/admin/deliveries/${delivery}/events`],
        ['POST', `/admin/deliveries/${delivery}/refund`],
        ['GET', '/admin/documents'],
        ['GET', `/admin/documents/${UUID}/file`],
        ['GET', '/admin/users'],
        ['POST', `/admin/users/${owner.id}/block`],
        ['GET', '/admin/audit'],
        ['GET', '/admin/safety/alerts'],
        ['GET', `/admin/rides/${ride}/trip-record`],
        ['GET', '/admin/insurance/claims'],
        ['GET', '/admin/welcome-points'],
        ['POST', '/admin/surplus/close'],
        ['GET', '/panel/budget'],
      ];
      for (const u of [owner, intruder, driverA, driverB])
        for (const [m, p] of paths) {
          const r = await t.req(m, p, u.token, m === 'POST' ? {} : undefined);
          expect(r.status, `${m} ${p} como ${u.id.slice(0, 4)}`).toBe(403);
        }
      for (const [m, p] of paths) expect((await t.req(m, p)).status, `${m} ${p} anônimo`).toBe(401);
    });

    it('escalada de papel: o corpo não promove ninguém a ADMIN', async () => {
      const r = await t.post('/me/onboarding', intruder.token, {
        name: 'Intruso',
        roles: ['ADMIN'],
        acceptPrivacyPolicy: true,
        policyVersion: 'x',
      });
      expect(r.status).toBe(400);
      const extra = await t.post('/me/onboarding', intruder.token, {
        name: 'Intruso',
        roles: ['PASSAGEIRO'],
        isAdmin: true,
        role: 'ADMIN',
        acceptPrivacyPolicy: true,
        policyVersion: 'x',
      });
      expect(extra.status).toBe(400); // campos fora do DTO são recusados (mass assignment)
      const me = await t.get('/me', intruder.token);
      expect(me.body.roles).not.toContain('ADMIN');
    });

    it('mass assignment: perfil de motorista não aceita campos de verificação', async () => {
      const r = await t.put('/driver/profile', driverB.token, {
        fullName: 'Fulano de Tal',
        cpf: '52998224725',
        birthDate: '1990-01-01',
        genderVerifiedAt: new Date().toISOString(),
        associationRate: 0,
        userId: driverA.id,
      });
      expect(r.status).toBe(400);
    });
  });

  // ------------------------------------------------------------------ pontos de acolhida e seguro
  describe('pontos de acolhida e seguro mútuo', () => {
    it('só o dono edita, apaga, envia foto e vê visitas; só o visitante encerra o próprio check-in', async () => {
      const admin = await t.admin();
      const host = await t.client('Anfitriã');
      const other = await t.client('Outra');
      const ana = await t.driver('Ana');
      const bruno = await t.driver('Bruno');
      const p = (
        await t.post('/welcome-points', host.token, {
          type: 'COMERCIO',
          name: 'Padaria Boa Hora',
          address: 'Rua das Flores, 100',
          neighborhood: 'Manaíra',
          lat: PICKUP.lat,
          lng: PICKUP.lng,
          hours: { always: true, slots: [] },
          amenities: ['AGUA'],
          capacity: 4,
        })
      ).body;
      void admin;
      void CHECKLIST;
      expect(
        notAllowed(
          (await t.patch(`/welcome-points/${p.id}`, other.token, { name: 'Invadido' })).status,
        ),
      ).toBe(true);
      expect(notAllowed((await t.del(`/welcome-points/${p.id}`, other.token)).status)).toBe(true);
      expect(notAllowed((await t.get(`/welcome-points/${p.id}/visits`, other.token)).status)).toBe(
        true,
      );
      const ci = await t.post(`/welcome-points/${p.id}/check-in`, ana.token, near(0));
      expect(ci.status).toBe(201);
      const cid = ci.body.checkIn.id;
      expect((await t.post(`/welcome-points/check-ins/${cid}/end`, bruno.token)).status).toBe(404);
      expect(
        (await t.post(`/welcome-points/check-ins/${cid}/rate`, bruno.token, { stars: 1 })).status,
      ).toBe(404);
      expect(
        (await t.post(`/welcome-points/check-ins/${cid}/rate-visitor`, other.token, { stars: 1 }))
          .status,
      ).toBe(404);
      expect((await t.post(`/welcome-points/check-ins/${cid}/end`, ana.token)).status).toBe(200);
    });

    it('pedido de seguro de outro sócio: ler, anexar e cancelar → 404', async () => {
      const a = await t.member('Ana', 4);
      const b = await t.member('Bruno', 4);
      const claim = (
        await t.post('/insurance/claims', a.token, {
          kind: 'ACIDENTE',
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
          description: 'Caí da moto na Av. Epitácio Pessoa e quebrei a carenagem.',
          requestedCents: 800_00,
        })
      ).body;
      expect((await t.get(`/insurance/claims/${claim.id}`, b.token)).status).toBe(404);
      expect(
        (await t.get(`/insurance/claims/${claim.id}/attachments/${UUID}`, b.token)).status,
      ).toBe(404);
      expect((await t.post(`/insurance/claims/${claim.id}/cancel`, b.token)).status).toBe(404);
      expect((await t.get('/insurance/claims', b.token)).body).toEqual([]);
    });
  });
});

function notAllowed(status: number) {
  return [401, 403, 404].includes(status);
}
