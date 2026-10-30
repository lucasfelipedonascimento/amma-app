import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { near, TestApp, type TestUser } from './helpers';

describe('associação: taxa, cotas, nível e progresso', () => {
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
    await t.online(driver, near(150));
  });

  const me = async (token = driver.token) => (await t.get('/association/me', token)).body;

  it('motorista novo: sem cotas, Bronze, ainda não é sócio', async () => {
    const r = await me();
    expect(r).toMatchObject({
      associationRate: 0,
      rateOptions: [0, 2, 4],
      quotaValueCents: 500,
      quotas: 0,
      remainderCents: 0,
      isMember: false,
      minQuotasToBeMember: 1,
      progress: {
        level: 'BRONZE',
        nextLevel: 'SILVER',
        quotasToNext: 30,
        centsToNext: 15000,
        percent: 0,
      },
      history: [],
    });
  });

  it('escolher a taxa vale para as próximas corridas e aparece no resumo', async () => {
    expect((await t.put('/driver/association-rate', driver.token, { rate: 4 })).status).toBe(200);
    expect((await me()).associationRate).toBe(4);
    await t.runToDelivered(client, driver);
    // R$ 11,00 a 4% = R$ 0,44: ainda não completa uma cota, fica como fração.
    const r = await me();
    expect(r).toMatchObject({ quotas: 0, remainderCents: 44, isMember: false });
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({ kind: 'RIDE_SETTLEMENT', cents: 44 });
  });

  it('só 0, 2 ou 4%', async () => {
    for (const rate of [1, 3, 5, -1, 'abc'])
      expect((await t.put('/driver/association-rate', driver.token, { rate })).status).toBe(400);
    expect((await me()).associationRate).toBe(0);
  });

  it('a taxa de 0% não gera cota', async () => {
    await t.runToDelivered(client, driver);
    expect(await me()).toMatchObject({ quotas: 0, remainderCents: 0, history: [] });
  });

  it('a fração acumulada completa uma cota e vira sócio', async () => {
    await t.put('/driver/association-rate', driver.token, { rate: 4 });
    for (let i = 0; i < 12; i++) await t.runToDelivered(client, driver); // 12 × 44 = 528
    expect(await me()).toMatchObject({ quotas: 1, remainderCents: 28, isMember: true });
  });

  it('nível e progresso: Bronze → Prata → Ouro', async () => {
    await t.giveQuotas(driver.id, 29);
    expect((await me()).progress).toMatchObject({
      level: 'BRONZE',
      quotasToNext: 1,
      centsToNext: 500,
      percent: 96,
    });
    await t.giveQuotas(driver.id, 1);
    expect((await me()).progress).toMatchObject({
      level: 'SILVER',
      nextLevel: 'GOLD',
      quotasToNext: 30,
      percent: 0,
    });
    await t.giveQuotas(driver.id, 30);
    expect((await me()).progress).toMatchObject({
      level: 'GOLD',
      nextLevel: null,
      quotasToNext: null,
      percent: 100,
    });
  });

  it('a mesma carteira do motorista mostra o nível (wallet) e bate com o resumo', async () => {
    await t.giveQuotas(driver.id, 30);
    const w = (await t.get('/driver/wallet', driver.token)).body;
    expect(w).toMatchObject({ quotas: 30, level: 'SILVER' });
    expect((await me()).quotas).toBe(w.quotas);
  });

  it('só motorista acessa; sem login não entra', async () => {
    expect((await t.get('/association/me', client.token)).status).toBe(403);
    expect((await t.get('/association/me')).status).toBe(401);
  });
});
