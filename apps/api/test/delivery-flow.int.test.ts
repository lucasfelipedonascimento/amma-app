import {
  PARTNER_RECEIVABLE,
  PLATFORM_REVENUE,
  workerBalanceAccount,
  workerQuotasAccount,
} from '@amma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CARD_OK, DROPOFF, PICKUP, TestApp, near, type TestUser } from './helpers';

describe('fluxo completo do pedido de entrega', () => {
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
    // 2%: R$ 11,00 => taxa base 1,10 | associação 0,22 | líquido 9,68 (exemplo de docs/REGRAS_FINANCEIRAS.md)
    driver = await t.driver('Maria', { associationRate: 2 });
    await t.online(driver, near(300));
  });

  it('CRIADO → … → ENTREGUE, com lançamentos corretos no ledger', async () => {
    const quote = await t.post('/deliveries/quote', client.token, {
      pickup: PICKUP,
      dropoff: DROPOFF,
    });
    expect(quote.status).toBe(200);
    expect(quote.body).toMatchObject({
      fareCents: 1100,
      minimumApplied: true,
      pricingVersion: 'teste-1',
    });

    // Cria e já é oferecido ao único motorista online.
    const created = await t.post('/deliveries', client.token, {
      pickup: PICKUP,
      dropoff: DROPOFF,
      notes: 'Frágil',
      payment: CARD_OK,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'OFERECIDO', fareCents: 1100, notes: 'Frágil' });
    const id = created.body.id;

    const offer = await t.currentOffer(driver);
    expect(offer).toMatchObject({ deliveryId: id, fareCents: 1100, estimatedNetCents: 968 });
    expect(offer.pickupEtaSeconds).toBeGreaterThan(0);

    const accepted = await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('ACEITO');
    // O cliente passa a ver o motorista (só id e nome); o próprio motorista não vê "driver".
    expect((await t.get(`/deliveries/${id}`, client.token)).body.driver).toEqual({
      id: driver.id,
      name: 'Maria',
    });

    for (const [step, status] of [
      ['en-route-pickup', 'A_CAMINHO_COLETA'],
      ['picked-up', 'COLETADO'],
      ['en-route-dropoff', 'A_CAMINHO_ENTREGA'],
      ['delivered', 'ENTREGUE'],
    ] as const) {
      if (step === 'delivered') await t.atDropoff(driver);
      const r = await t.post(`/driver/deliveries/${id}/${step}`, driver.token);
      expect(r.status, step).toBe(200);
      expect(r.body.status).toBe(status);
    }

    // Valores congelados no pedido (visão do motorista)
    const done = await t.get(`/deliveries/${id}`, driver.token);
    expect(done.body.settlement).toEqual({
      platformFeeCents: 110,
      associationFeeCents: 22,
      workerNetCents: 968,
      associationRate: 2,
    });
    // O cliente não vê o repasse
    expect((await t.get(`/deliveries/${id}`, client.token)).body.settlement).toBeNull();

    // Ledger: partidas dobradas, uma transação, valores exatos
    const txs = await t.prisma.ledgerTransaction.findMany({ include: { postings: true } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ kind: 'RIDE_SETTLEMENT', reference: id });
    const byAccount = Object.fromEntries(
      txs[0].postings.map((p) => [p.account, [p.direction, p.amountCents]]),
    );
    expect(byAccount).toEqual({
      [PARTNER_RECEIVABLE]: ['DEBIT', 1100],
      [workerBalanceAccount(driver.id)]: ['CREDIT', 968],
      [PLATFORM_REVENUE]: ['CREDIT', 110],
      [workerQuotasAccount(driver.id)]: ['CREDIT', 22],
    });
    const debit = txs[0].postings
      .filter((p) => p.direction === 'DEBIT')
      .reduce((s, p) => s + p.amountCents, 0);
    const credit = txs[0].postings
      .filter((p) => p.direction === 'CREDIT')
      .reduce((s, p) => s + p.amountCents, 0);
    expect(debit).toBe(credit);

    // Carteira: saldo e fração de cota (22 centavos < R$ 5)
    const wallet = await t.get('/driver/wallet', driver.token);
    expect(wallet.body).toEqual({
      balanceCents: 968,
      quotas: 0,
      remainderCents: 22,
      level: 'BRONZE',
    });

    // Linha do tempo do cliente: só estados, sem decisões internas do despacho
    const timeline = (await t.get(`/deliveries/${id}`, client.token)).body.timeline;
    expect(timeline.map((e: any) => e.status)).toEqual([
      'CRIADO',
      'OFERECIDO',
      'ACEITO',
      'A_CAMINHO_COLETA',
      'COLETADO',
      'A_CAMINHO_ENTREGA',
      'ENTREGUE',
    ]);
  });

  it('não dá para concluir duas vezes nem pular etapas; ledger não duplica', async () => {
    const id = await t.runToDelivered(client, driver);
    const again = await t.post(`/driver/deliveries/${id}/delivered`, driver.token);
    expect(again.status).toBe(409);
    expect(await t.prisma.ledgerTransaction.count()).toBe(1);

    // Pular etapa
    const client2 = await t.client();
    const d2 = await t.createDelivery(client2);
    const offer = await t.currentOffer(driver);
    await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    expect((await t.post(`/driver/deliveries/${d2.id}/delivered`, driver.token)).status).toBe(409);
    expect((await t.post(`/driver/deliveries/${d2.id}/picked-up`, driver.token)).status).toBe(409);
    expect(await t.prisma.ledgerTransaction.count()).toBe(1);
  });

  it('o banco recusa alterar ou apagar o ledger (somente inserção)', async () => {
    await t.runToDelivered(client, driver);
    await expect(t.prisma.ledgerPosting.updateMany({ data: { amountCents: 1 } })).rejects.toThrow(
      /somente inserção/,
    );
    await expect(t.prisma.ledgerPosting.deleteMany()).rejects.toThrow(/somente inserção/);
    await expect(t.prisma.ledgerTransaction.deleteMany()).rejects.toThrow(/somente inserção/);
    // O constraint também barra lançamento duplicado do mesmo pedido
    const tx = await t.prisma.ledgerTransaction.findFirstOrThrow();
    await expect(
      t.prisma.ledgerTransaction.create({
        data: { kind: 'RIDE_SETTLEMENT', reference: tx.reference },
      }),
    ).rejects.toThrow();
  });

  it('cotas acumulam entre entregas e sobem de nível pelo saldo do ledger', async () => {
    // 5 entregas de R$ 11,00 a 4% => 44 centavos cada; 12 delas passam de R$ 5 (1 cota)
    await t.put('/driver/association-rate', driver.token, { rate: 4 });
    for (let i = 0; i < 12; i++) await t.runToDelivered(await t.client(), driver);
    const w = (await t.get('/driver/wallet', driver.token)).body;
    // 12 × floor(1100 × 4%) = 12 × 44 = 528 centavos => 1 cota e 28 de resto
    expect(w).toMatchObject({ quotas: 1, remainderCents: 28, level: 'BRONZE' });
    expect(w.balanceCents).toBe(12 * (1100 - 110 - 44));
  });

  it('a taxa de associação só aceita 0, 2 ou 4', async () => {
    expect((await t.put('/driver/association-rate', driver.token, { rate: 3 })).status).toBe(400);
    expect((await t.put('/driver/association-rate', driver.token, { rate: 0 })).status).toBe(200);
  });

  it('exclusão de conta: bloqueada com pedido em andamento; depois apaga a presença e mantém o ledger', async () => {
    await t.createDelivery(client);
    expect((await t.req('DELETE', '/me', client.token)).status).toBe(409);
    const offer = await t.currentOffer(driver);
    await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    expect((await t.req('DELETE', '/me', driver.token)).status).toBe(409);

    const id = (await t.prisma.delivery.findFirstOrThrow()).id;
    for (const s of ['en-route-pickup', 'picked-up', 'en-route-dropoff', 'delivered']) {
      if (s === 'delivered') await t.atDropoff(driver);
      await t.post(`/driver/deliveries/${id}/${s}`, driver.token);
    }
    expect((await t.req('DELETE', '/me', driver.token)).status).toBe(204);
    expect(await t.prisma.driverPresence.count()).toBe(0);
    expect(await t.prisma.ledgerTransaction.count()).toBe(1); // financeiro permanece, sem identificação
    expect((await t.get('/driver/wallet', driver.token)).status).toBe(401);
  });

  describe('autorização', () => {
    it('exige login e papel certo', async () => {
      expect(
        (
          await t.post('/deliveries', undefined, {
            pickup: PICKUP,
            dropoff: DROPOFF,
            payment: CARD_OK,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await t.post('/deliveries', driver.token, {
            pickup: PICKUP,
            dropoff: DROPOFF,
            payment: CARD_OK,
          })
        ).status,
      ).toBe(403);
      expect((await t.get('/driver/wallet', client.token)).status).toBe(403);
      expect((await t.get('/admin/dispatch-settings', client.token)).status).toBe(403);
    });

    it('só dono, motorista responsável e admin enxergam o pedido', async () => {
      const d = await t.createDelivery(client);
      const stranger = await t.client('Outro');
      const otherDriver = await t.driver('Outro motorista');
      const admin = await t.admin();
      expect((await t.get(`/deliveries/${d.id}`, stranger.token)).status).toBe(404);
      expect((await t.get(`/deliveries/${d.id}`, otherDriver.token)).status).toBe(404);
      expect((await t.get(`/deliveries/${d.id}`, admin.token)).status).toBe(200);
      expect((await t.get(`/deliveries/${d.id}`, client.token)).status).toBe(200);
      // Mesmo o motorista escolhido só passa a ver depois de aceitar
      expect((await t.get(`/deliveries/${d.id}`, driver.token)).status).toBe(404);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      expect((await t.get(`/deliveries/${d.id}`, driver.token)).status).toBe(200);
      // Outro motorista não consegue avançar o pedido
      expect(
        (await t.post(`/driver/deliveries/${d.id}/en-route-pickup`, otherDriver.token)).status,
      ).toBe(404);
    });

    it('lista só os pedidos do próprio cliente', async () => {
      await t.createDelivery(client);
      const other = await t.client();
      expect((await t.get('/deliveries', client.token)).body).toHaveLength(1);
      expect((await t.get('/deliveries', other.token)).body).toHaveLength(0);
    });
  });

  describe('validação', () => {
    it('rejeita coordenadas inválidas, campos extras e coleta = entrega', async () => {
      const bad = (body: Record<string, unknown>) =>
        t.post('/deliveries', client.token, { payment: CARD_OK, ...body });
      expect((await bad({ pickup: { ...PICKUP, lat: 91 }, dropoff: DROPOFF })).status).toBe(400);
      expect((await bad({ pickup: PICKUP, dropoff: DROPOFF, workerId: 'x' })).status).toBe(400);
      expect((await bad({ pickup: PICKUP })).status).toBe(400);
      expect((await bad({ pickup: PICKUP, dropoff: PICKUP })).status).toBe(400);
    });

    it('sem tabela de preço vigente, não cota (503)', async () => {
      await t.prisma.pricingConfigVersion.deleteMany();
      const r = await t.post('/deliveries/quote', client.token, {
        pickup: PICKUP,
        dropoff: DROPOFF,
      });
      expect(r.status).toBe(503);
    });
  });

  describe('preço versionado', () => {
    it('a entrega usa a versão vigente e guarda qual foi; versão nova não reescreve o passado', async () => {
      const admin = await t.admin();
      const d1 = await t.createDelivery(client);
      const future = new Date(Date.now() + 3_600_000).toISOString();
      const created = await t.post('/admin/pricing', admin.token, {
        version: 'teste-2',
        effectiveFrom: future,
        baseCents: 500,
        perKmCents: 200,
        perMinuteCents: 50,
        minimumFareCents: 900,
      });
      expect(created.status).toBe(201);
      // Não pode reescrever o passado
      const past = await t.post('/admin/pricing', admin.token, {
        version: 'teste-3',
        effectiveFrom: '2025-01-01T00:00:00Z',
        baseCents: 1,
        perKmCents: 1,
        perMinuteCents: 1,
        minimumFareCents: 1,
      });
      expect(past.status).toBe(409);
      expect((await t.get(`/deliveries/${d1.id}`, client.token)).body.pricingVersion).toBe(
        'teste-1',
      );
      // A nova só vale a partir de `future`: ainda cota pela antiga
      expect(
        (await t.post('/deliveries/quote', client.token, { pickup: PICKUP, dropoff: DROPOFF })).body
          .pricingVersion,
      ).toBe('teste-1');
    });
  });
});
