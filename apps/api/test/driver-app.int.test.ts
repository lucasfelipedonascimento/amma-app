import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOCATION_CONSENT_VERSION } from '@amma/shared';
import { PUSH_SENDER, SimulatedPushSender } from '../src/push/push.service';
import { PICKUP, TestApp, near, type TestUser } from './helpers';

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

describe('app do motorista: ganhos, rota, consentimento, push e posição', () => {
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
    driver = await t.driver('Maria', { associationRate: 2 });
    await t.online(driver, near(150));
  });

  const del = (path: string, token: string, body?: unknown) => t.req('DELETE', path, token, body);

  describe('GET /driver/earnings', () => {
    it('soma hoje, semana e histórico e compara com a taxa de 25%', async () => {
      await t.runToDelivered(client, driver);
      await t.runToDelivered(client, driver);
      const { status, body } = await t.get('/driver/earnings', driver.token);
      expect(status).toBe(200);
      expect(body.associationRate).toBe(2);
      // R$ 11,00 a 2%: líquido R$ 9,68. Duas entregas = R$ 22,00 bruto, R$ 19,36 líquido.
      expect(body.today).toMatchObject({
        deliveries: 2,
        grossCents: 2200,
        platformFeeCents: 220,
        associationFeeCents: 44,
        netCents: 1936,
        competitorNetCents: 1650,
        extraCents: 286,
      });
      expect(body.week.days).toHaveLength(7);
      expect(body.week).toMatchObject({ deliveries: 2, netCents: 1936 });
      expect(body.history).toHaveLength(2);
      expect(body.history[0]).toMatchObject({ fareCents: 1100, workerNetCents: 968 });
    });

    it('é só do próprio motorista e vem zerada sem entregas', async () => {
      await t.runToDelivered(client, driver);
      const other = await t.driver('Outra');
      const { body } = await t.get('/driver/earnings', other.token);
      expect(body.today).toMatchObject({ deliveries: 0, netCents: 0, extraCents: 0 });
      expect(body.history).toEqual([]);
    });

    it('cliente não acessa (403) e sem login é 401', async () => {
      expect((await t.get('/driver/earnings', client.token)).status).toBe(403);
      expect((await t.get('/driver/earnings')).status).toBe(401);
    });
  });

  describe('GET /driver/deliveries/:id/route', () => {
    it('vai para a coleta e, depois de coletar, para a entrega', async () => {
      const d = await t.createDelivery(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      const from = near(150);

      const toPickup = await t.get(
        `/driver/deliveries/${d.id}/route?lat=${from.lat}&lng=${from.lng}`,
        driver.token,
      );
      expect(toPickup.status).toBe(200);
      expect(toPickup.body.target).toBe('COLETA');
      expect(toPickup.body.destination).toMatchObject({ lat: PICKUP.lat, lng: PICKUP.lng });
      expect(toPickup.body.path.length).toBeGreaterThanOrEqual(2);
      expect(toPickup.body.distanceMeters).toBeGreaterThan(0);

      for (const step of ['en-route-pickup', 'picked-up'])
        await t.post(`/driver/deliveries/${d.id}/${step}`, driver.token);
      const toDropoff = await t.get(
        `/driver/deliveries/${d.id}/route?lat=${PICKUP.lat}&lng=${PICKUP.lng}`,
        driver.token,
      );
      expect(toDropoff.body.target).toBe('ENTREGA');
    });

    it('valida a posição, esconde pedido de outro motorista e recusa pedido encerrado', async () => {
      const d = await t.createDelivery(client);
      await t.post(`/driver/offers/${(await t.currentOffer(driver)).id}/accept`, driver.token);
      const q = `lat=${PICKUP.lat}&lng=${PICKUP.lng}`;
      expect(
        (await t.get(`/driver/deliveries/${d.id}/route?lat=abc&lng=1`, driver.token)).status,
      ).toBe(400);
      expect(
        (await t.get(`/driver/deliveries/${d.id}/route?lat=99&lng=1`, driver.token)).status,
      ).toBe(400);
      const other = await t.driver('Outra');
      expect((await t.get(`/driver/deliveries/${d.id}/route?${q}`, other.token)).status).toBe(404);
      for (const step of ['en-route-pickup', 'picked-up', 'en-route-dropoff', 'delivered'])
        await t.post(`/driver/deliveries/${d.id}/${step}`, driver.token);
      expect((await t.get(`/driver/deliveries/${d.id}/route?${q}`, driver.token)).status).toBe(409);
    });
  });

  describe('consentimento de localização', () => {
    it('começa sem consentimento, registra com a versão certa e pode ser revogado', async () => {
      expect((await t.get('/driver/location-consent', driver.token)).body).toMatchObject({
        granted: false,
        version: LOCATION_CONSENT_VERSION,
      });
      const old = await t.post('/driver/location-consent', driver.token, { version: '1999-01-01' });
      expect(old.status).toBe(400);

      const ok = await t.post('/driver/location-consent', driver.token, {
        version: LOCATION_CONSENT_VERSION,
      });
      expect(ok.body.granted).toBe(true);
      // Repetir não duplica o registro.
      await t.post('/driver/location-consent', driver.token, { version: LOCATION_CONSENT_VERSION });
      expect(
        await t.prisma.consent.count({
          where: { userId: driver.id, type: 'LOCALIZACAO_SEGUNDO_PLANO' },
        }),
      ).toBe(1);

      expect((await del('/driver/location-consent', driver.token)).status).toBe(204);
      expect((await t.get('/driver/location-consent', driver.token)).body.granted).toBe(false);
    });
  });

  describe('push', () => {
    const sender = () => t.app.get<SimulatedPushSender>(PUSH_SENDER);

    it('recusa token fora do formato do Expo', async () => {
      const r = await t.req('PUT', '/driver/push-token', driver.token, {
        token: 'abc',
        platform: 'android',
      });
      expect(r.status).toBe(400);
    });

    it('nova oferta dispara push ao motorista, sem endereço na mensagem', async () => {
      await t.req('PUT', '/driver/push-token', driver.token, {
        token: TOKEN_A,
        platform: 'android',
      });
      sender().outbox.length = 0;
      await t.createDelivery(client);
      await new Promise((r) => setTimeout(r, 100));
      const sent = sender().outbox.at(-1)!;
      expect(sent.tokens).toEqual([TOKEN_A]);
      expect(sent.message.title).toBe('Novo pedido de entrega');
      expect(sent.message.body).toContain('9,68');
      expect(JSON.stringify(sent.message)).not.toContain('Rua da');
      expect(sent.message.data).toMatchObject({ type: 'offer' });
    });

    it('o token muda de dono se outra pessoa entra no mesmo aparelho, e some no logout', async () => {
      const other = await t.driver('Outra');
      await t.req('PUT', '/driver/push-token', driver.token, {
        token: TOKEN_A,
        platform: 'android',
      });
      await t.req('PUT', '/driver/push-token', other.token, {
        token: TOKEN_A,
        platform: 'android',
      });
      expect(
        (await t.prisma.pushToken.findUniqueOrThrow({ where: { token: TOKEN_A } })).userId,
      ).toBe(other.id);
      // Quem não é o dono não apaga o token do outro.
      await del('/driver/push-token', driver.token, { token: TOKEN_A, platform: 'android' });
      expect(await t.prisma.pushToken.count()).toBe(1);
      await del('/driver/push-token', other.token, { token: TOKEN_A, platform: 'android' });
      expect(await t.prisma.pushToken.count()).toBe(0);
    });

    it('excluir a conta apaga os tokens', async () => {
      await t.req('PUT', '/driver/push-token', driver.token, { token: TOKEN_A, platform: 'ios' });
      await t.post('/driver/presence/offline', driver.token);
      expect((await del('/me', driver.token)).status).toBe(204);
      expect(await t.prisma.pushToken.count()).toBe(0);
    });
  });

  describe('POST /driver/position', () => {
    it('grava a posição de quem está online', async () => {
      const p = near(300);
      const r = await t.post('/driver/position', driver.token, p);
      expect(r.body).toEqual({ accepted: true });
      expect((await t.get('/driver/presence', driver.token)).body.position).toMatchObject(p);
    });

    it('avisa (accepted=false) quando o motorista está offline, para o app parar de enviar', async () => {
      await t.post('/driver/presence/offline', driver.token);
      const r = await t.post('/driver/position', driver.token, near(300));
      expect(r.body).toEqual({ accepted: false });
    });

    it('rejeita coordenadas inválidas', async () => {
      expect((await t.post('/driver/position', driver.token, { lat: 200, lng: 0 })).status).toBe(
        400,
      );
    });
  });
});
