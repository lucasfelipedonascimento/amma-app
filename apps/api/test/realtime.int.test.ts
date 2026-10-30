import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../src/common/redis.service';
import { TestApp, WsClient, near, type TestUser } from './helpers';

describe('tempo real (WebSocket), Redis e PostGIS', () => {
  let t: TestApp;
  let client: TestUser;
  let driver: TestUser;
  const sockets: WsClient[] = [];

  const connect = async (user?: TestUser) => {
    const ws = await WsClient.connect(t.wsUrl);
    sockets.push(ws);
    if (user) await ws.authenticate(user.token);
    return ws;
  };
  const geoOf = async (id: string) => {
    const rows = await t.prisma.$queryRaw<{ lat: number; lng: number; at: Date }[]>`
      SELECT ST_Y(location::geometry)::float8 AS lat, ST_X(location::geometry)::float8 AS lng, "locationAt" AS at
      FROM "DriverPresence" WHERE "userId" = ${id}`;
    return rows[0];
  };

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await t.reset();
    client = await t.client();
    driver = await t.driver('Maria');
  });

  it('exige auth: sem token válido a conexão é fechada', async () => {
    const ws = await connect();
    ws.send('auth', { token: 'lixo' });
    expect(await ws.closed).toBe(4401);

    const silent = await connect();
    silent.send('position', { lat: -7.1, lng: -34.8 });
    expect((await silent.next('error')).code).toBe('UNAUTHENTICATED');
  });

  it('posição vai para o Redis e o PostGIS; só motorista online pode enviar', async () => {
    const ws = await connect(driver);
    // offline: recusada
    ws.send('position', near(100));
    expect((await ws.next('error')).code).toBe('OFFLINE');

    await t.online(driver, near(100));
    await new Promise((r) => setTimeout(r, 1100)); // a mensagem recusada acima também conta no limite de 1/s
    expect(await geoOf(driver.id)).toMatchObject({ lat: expect.closeTo(near(100).lat, 6) });

    // Redis recebe a cada mensagem; o PostGIS é limitado (5 s): a 1ª atualização depois do
    // "online" cai dentro da janela e fica só no Redis.
    ws.send('position', near(500));
    await ws.next('position.ok');
    const redis = t.app.get(RedisService);
    const hot = JSON.parse((await redis.get(`driver:pos:${driver.id}`))!);
    expect(hot).toMatchObject({ lat: expect.closeTo(near(500).lat, 6), lng: near(500).lng });
    expect((await geoOf(driver.id)).lat).toBeCloseTo(near(100).lat, 6); // PostGIS ainda na posição antiga

    // Libera a janela e envia de novo: agora grava no PostGIS
    await redis.del(`driver:persist:${driver.id}`);
    await new Promise((r) => setTimeout(r, 1100)); // respeita o intervalo mínimo entre posições
    ws.send('position', near(700));
    await ws.next('position.ok');
    expect((await geoOf(driver.id)).lat).toBeCloseTo(near(700).lat, 6);
  });

  it('valida a posição e limita a frequência', async () => {
    await t.online(driver, near(100));
    const ws = await connect(driver);
    for (const bad of [{ lat: 100, lng: 0 }, { lat: 'x', lng: 0 }, null, {}]) {
      ws.send('position', bad);
      expect((await ws.next('error')).code).toBe('BAD_REQUEST');
    }
    // Duas seguidas dentro de 1 s: a segunda é descartada em silêncio
    ws.send('position', near(200));
    ws.send('position', near(900));
    await ws.next('position.ok');
    await expect(ws.next('position.ok', 400)).rejects.toThrow(/Timeout/);
    const hot = JSON.parse((await t.app.get(RedisService).get(`driver:pos:${driver.id}`))!);
    expect(hot.lat).toBeCloseTo(near(200).lat, 6);
  });

  it('só motoristas enviam posição', async () => {
    const ws = await connect(client);
    ws.send('position', near(100));
    expect((await ws.next('error')).code).toBe('FORBIDDEN');
  });

  it('ficar offline apaga a posição do Redis e do PostGIS', async () => {
    await t.online(driver, near(100));
    await t.post('/driver/presence/offline', driver.token);
    expect((await geoOf(driver.id)).lat).toBeNull();
    expect(await t.app.get(RedisService).get(`driver:pos:${driver.id}`)).toBeNull();
    expect((await t.get('/driver/presence', driver.token)).body).toMatchObject({
      online: false,
      position: null,
    });
  });

  it('se o Redis perder a flag, o servidor confirma no banco e segue aceitando posições', async () => {
    await t.online(driver, near(100));
    await t.app.get(RedisService).flushdb();
    const ws = await connect(driver);
    ws.send('position', near(300));
    await ws.next('position.ok');
  });

  it('a oferta chega ao motorista por WebSocket e o cliente acompanha tudo em tempo real', async () => {
    await t.online(driver, near(300));
    const wsDriver = await connect(driver);
    const wsClient = await connect(client);

    const d = await t.createDelivery(client);
    const pushed = await wsDriver.next('offer.created');
    expect(pushed).toMatchObject({ deliveryId: d.id, fareCents: 1100, estimatedNetCents: 990 });
    expect((await wsClient.next('delivery.updated')).status).toBe('OFERECIDO');

    await t.post(`/driver/offers/${pushed.id}/accept`, driver.token);
    expect((await wsClient.next('delivery.updated')).status).toBe('ACEITO');

    // Posição do motorista chega ao cliente durante a entrega
    wsDriver.send('position', near(250));
    const pos = await wsClient.next('driver.position');
    expect(pos).toMatchObject({ deliveryId: d.id, lat: expect.closeTo(near(250).lat, 6) });
    // ...e também na consulta REST (a partir do Redis)
    const view = await t.get(`/deliveries/${d.id}`, client.token);
    expect(view.body.driverPosition).toMatchObject({ lat: expect.closeTo(near(250).lat, 6) });

    await t.post(`/driver/deliveries/${d.id}/en-route-pickup`, driver.token);
    expect((await wsClient.next('delivery.updated')).status).toBe('A_CAMINHO_COLETA');

    // Terminada a entrega, o cliente deixa de receber a posição
    for (const s of ['picked-up', 'en-route-dropoff', 'delivered']) {
      if (s === 'delivered') {
        await new Promise((r) => setTimeout(r, 1100)); // a API descarta posições com menos de 1 s de intervalo
        await t.atDropoff(driver);
        await wsClient.next('driver.position'); // a posição no destino ainda é repassada ao cliente
      }
      await t.post(`/driver/deliveries/${d.id}/${s}`, driver.token);
    }
    await new Promise((r) => setTimeout(r, 1100));
    wsDriver.send('position', near(10));
    await wsDriver.next('position.ok');
    await expect(wsClient.next('driver.position', 300)).rejects.toThrow(/Timeout/);
    expect((await t.get(`/deliveries/${d.id}`, client.token)).body.driverPosition).toBeNull();
  });

  it('oferta expirada avisa o motorista (offer.closed) e o cliente não vê a posição de quem ainda não aceitou', async () => {
    await t.online(driver, near(300));
    const wsDriver = await connect(driver);
    const wsClient = await connect(client);
    await t.createDelivery(client);
    const offer = await wsDriver.next('offer.created');
    wsDriver.send('position', near(280));
    await wsDriver.next('position.ok');
    await expect(wsClient.next('driver.position', 300)).rejects.toThrow(/Timeout/);

    await t.expireOffers();
    await t.dispatch.tick();
    expect(await wsDriver.next('offer.closed')).toMatchObject({
      offerId: offer.id,
      reason: 'EXPIROU',
    });
  });
});
