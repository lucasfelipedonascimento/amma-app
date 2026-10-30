import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUSH_SENDER, SimulatedPushSender } from '../src/push/push.service';
import { TestApp, near, type TestUser } from './helpers';

describe('chat do pedido entre cliente e motorista', () => {
  let t: TestApp;
  let client: TestUser;
  let driver: TestUser;
  let id: string;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    client = await t.client();
    driver = await t.driver('Maria');
    await t.online(driver, near(150));
    id = (await t.createDelivery(client)).id;
  });

  const accept = async () => {
    const offer = await t.currentOffer(driver);
    await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
  };
  const msgs = (token: string) => t.get(`/deliveries/${id}/messages`, token);

  it('sem motorista atendendo o chat está fechado', async () => {
    const r = await t.post(`/deliveries/${id}/messages`, client.token, { body: 'Oi' });
    expect(r.status).toBe(409);
  });

  it('os dois lados conversam, cada um vendo o que é seu (fromMe)', async () => {
    await accept();
    const a = await t.post(`/deliveries/${id}/messages`, driver.token, {
      body: '  Estou chegando  ',
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ body: 'Estou chegando', fromMe: true });
    await t.post(`/deliveries/${id}/messages`, client.token, { body: 'Estou na portaria' });

    const forClient = (await msgs(client.token)).body;
    expect(forClient.map((m: { body: string; fromMe: boolean }) => [m.body, m.fromMe])).toEqual([
      ['Estou chegando', false],
      ['Estou na portaria', true],
    ]);
    const forDriver = (await msgs(driver.token)).body;
    expect(forDriver.map((m: { fromMe: boolean }) => m.fromMe)).toEqual([true, false]);
  });

  it('quem não participa não lê nem escreve (404)', async () => {
    await accept();
    const stranger = await t.client('Outro');
    expect((await msgs(stranger.token)).status).toBe(404);
    expect(
      (await t.post(`/deliveries/${id}/messages`, stranger.token, { body: 'oi' })).status,
    ).toBe(404);
    const admin = await t.admin();
    expect((await msgs(admin.token)).status).toBe(404);
    expect((await msgs('')).status).toBe(401);
  });

  it('valida o texto: vazio e acima de 500 caracteres são recusados', async () => {
    await accept();
    for (const body of ['', '   ', 'x'.repeat(501)]) {
      const r = await t.post(`/deliveries/${id}/messages`, client.token, { body });
      expect([400, 409]).toContain(r.status);
    }
  });

  it('avisa o outro lado em tempo real e, sem WebSocket, por push (sem o texto)', async () => {
    await accept();
    await t.req('PUT', '/driver/push-token', driver.token, {
      token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
      platform: 'android',
    });
    const sender = t.app.get<SimulatedPushSender>(PUSH_SENDER);
    sender.outbox.length = 0;
    await t.post(`/deliveries/${id}/messages`, client.token, { body: 'Segredo do portão 1234' });
    await new Promise((r) => setTimeout(r, 100));
    const chat = sender.outbox.find((o) => o.message.data?.type === 'chat');
    expect(chat).toBeTruthy();
    expect(JSON.stringify(chat!.message)).not.toContain('1234');
  });

  it('depois de cancelar o chat fecha para escrita, mas continua legível aos dois', async () => {
    await accept();
    await t.post(`/deliveries/${id}/messages`, client.token, { body: 'Oi' });
    await t.post(`/deliveries/${id}/cancel`, client.token, { reason: 'CLIENTE_DESISTIU' });
    expect(
      (await t.post(`/deliveries/${id}/messages`, client.token, { body: 'Ainda aí?' })).status,
    ).toBe(409);
    expect((await msgs(driver.token)).body).toHaveLength(1);
  });
});
