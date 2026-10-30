import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp, type TestUser } from './helpers';

const Y = 2025;
const inYear = (month: number, year = Y) => new Date(Date.UTC(year, month - 1, 15, 15, 0, 0));
const sim = (extra: object = {}) => ({
  year: Y,
  distributableCents: 10_000_00,
  useWeightPercent: 50,
  ...extra,
});

describe('sobras anuais: simulação, fechamento e distribuição', () => {
  let t: TestApp;
  let admin: TestUser;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let client: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
    client = await t.client();
    // Cotas que já existiam no fim de 2025.
    a = await t.driver('Ana');
    b = await t.driver('Bruno');
    c = await t.driver('Carla');
    await t.giveQuotas(a.id, 10, inYear(3));
    await t.giveQuotas(b.id, 30, inYear(4));
    await t.giveQuotas(c.id, 20, inYear(5));
  });

  /** Entrega concluída direto no banco, em uma data de 2025 (a rota real usa "agora"). */
  let seq = 0;
  const delivered = (
    worker: TestUser,
    fareCents: number,
    at: Date | null = inYear(6),
    status: 'ENTREGUE' | 'CANCELADO' = 'ENTREGUE',
  ) =>
    t.prisma.delivery.create({
      data: {
        clientId: client.id,
        workerId: worker.id,
        status,
        pickupLat: -7.1,
        pickupLng: -34.8,
        pickupAddress: `Rua ${++seq}`,
        dropoffLat: -7.2,
        dropoffLng: -34.9,
        dropoffAddress: 'Rua B',
        distanceMeters: 1000,
        durationSeconds: 300,
        fareCents,
        pricingVersion: 'teste-1',
        minimumApplied: false,
        deliveredAt: at,
      },
    });
  const simulate = (body: object = sim(), u = admin) =>
    t.post('/admin/surplus/simulate', u.token, body);
  const close = (body: object, u = admin) => t.post('/admin/surplus/close', u.token, body);
  const amounts = (r: any) =>
    Object.fromEntries(r.body.shares.map((s: any) => [s.userId, s.amountCents]));

  describe('simulação', () => {
    it('divide por uso e por cotas, sem gravar nada', async () => {
      await delivered(a, 100_00);
      await delivered(b, 300_00);
      // c não trabalhou. cotas 10/30/20 (total 60); uso 100/300/0 (total 400).
      const r = await simulate();
      expect(r.status).toBe(200);
      expect(r.body.totals).toMatchObject({
        members: 3,
        quotas: 60,
        useCents: 400_00,
        distributedCents: 10_000_00,
      });
      // 50% por cotas + 50% por uso, sobre R$ 10.000,00.
      expect(amounts(r)).toEqual({
        [a.id]: Math.round(10_000_00 * (0.5 * (10 / 60) + 0.5 * (100 / 400))),
        [b.id]: Math.round(10_000_00 * (0.5 * (30 / 60) + 0.5 * (300 / 400))),
        [c.id]: Math.round(10_000_00 * (0.5 * (20 / 60))),
      });
      expect(await t.prisma.surplusRun.count()).toBe(0);
      expect(
        await t.prisma.ledgerTransaction.count({ where: { kind: 'SURPLUS_DISTRIBUTION' } }),
      ).toBe(0);
    });

    it('a soma das partes é exatamente o total, sem sobrar nem faltar centavo', async () => {
      await delivered(a, 33_33);
      await delivered(b, 11_11);
      await delivered(c, 7_77);
      for (const total of [1, 99, 10_000_01, 123_456_79]) {
        const r = await simulate(sim({ distributableCents: total }));
        expect(r.body.shares.reduce((s: number, x: any) => s + x.amountCents, 0)).toBe(total);
        expect(r.body.totals.distributedCents).toBe(total);
      }
    });

    it('o peso do uso muda a divisão (0% = só cotas, 100% = só uso)', async () => {
      await delivered(a, 100_00);
      await delivered(b, 100_00);
      const onlyQuotas = amounts(await simulate(sim({ useWeightPercent: 0 })));
      expect(onlyQuotas).toEqual({ [a.id]: 1_666_67, [b.id]: 5_000_00, [c.id]: 3_333_33 });
      const onlyUse = amounts(await simulate(sim({ useWeightPercent: 100 })));
      expect(onlyUse).toEqual({ [a.id]: 5_000_00, [b.id]: 5_000_00, [c.id]: 0 });
    });

    it('só conta o uso daquele ano: entregas de outro ano ficam de fora', async () => {
      await delivered(a, 100_00);
      await delivered(b, 900_00, inYear(6, 2024));
      await delivered(b, 900_00, inYear(6, 2026));
      expect((await simulate()).body.totals.useCents).toBe(100_00);
      // Fronteiras do ano no fuso de João Pessoa (UTC−3).
      await delivered(c, 50_00, new Date('2026-01-01T02:59:59Z')); // ainda 2025
      await delivered(c, 70_00, new Date('2026-01-01T03:00:00Z')); // já 2026
      expect((await simulate()).body.totals.useCents).toBe(150_00);
    });

    it('entrega cancelada não é uso', async () => {
      await delivered(a, 100_00);
      await delivered(a, 500_00, null, 'CANCELADO');
      expect((await simulate()).body.totals.useCents).toBe(100_00);
    });

    it('usa as cotas do fim do ano: quem ganhou cota depois não entra, e quem não era sócio fica de fora', async () => {
      const late = await t.driver('Tardia');
      await t.giveQuotas(late.id, 50, inYear(2, 2026));
      await delivered(late, 999_00);
      const r = await simulate();
      expect(r.body.totals.members).toBe(3);
      expect(amounts(r)[late.id]).toBeUndefined();
      expect(r.body.totals.useCents).toBe(0); // o uso da tardia não entra
    });

    it('conta excluída não recebe', async () => {
      await t.prisma.user.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      expect((await simulate()).body.totals.members).toBe(2);
    });

    it('ano sem uso nenhum: divide só pelas cotas', async () => {
      const r = await simulate(sim({ useWeightPercent: 90 }));
      expect(amounts(r)).toEqual({ [a.id]: 1_666_67, [b.id]: 5_000_00, [c.id]: 3_333_33 });
    });

    it('sem sócios no ano, não há o que dividir', async () => {
      expect((await simulate(sim({ year: 2020 }))).status).toBe(400);
    });

    it('informa se o ano já acabou e se já foi fechado', async () => {
      expect((await simulate()).body).toMatchObject({ yearOver: true, alreadyClosed: false });
      const current = new Date().getFullYear();
      expect((await simulate(sim({ year: current }))).body.yearOver).toBe(false);
    });

    it('valores inválidos e permissão', async () => {
      for (const bad of [
        { distributableCents: 0 },
        { distributableCents: 10.5 },
        { useWeightPercent: 101 },
        { useWeightPercent: -1 },
        { year: 1999 },
      ])
        expect((await simulate(sim(bad))).status).toBe(400);
      expect((await simulate(sim(), a)).status).toBe(403);
      expect((await t.post('/admin/surplus/simulate', undefined, sim())).status).toBe(401);
    });
  });

  describe('fechamento', () => {
    beforeEach(async () => {
      await delivered(a, 100_00);
      await delivered(b, 300_00);
    });
    const closeBody = async (extra: object = {}) => ({
      ...sim(extra),
      checksum: (await simulate(sim(extra))).body.checksum,
    });

    it('grava o resultado e lança no ledger, creditando o saldo de cada sócio', async () => {
      const preview = await simulate();
      const r = await close(await closeBody());
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ year: Y, distributedCents: 10_000_00, memberCount: 3 });
      const shares = await t.prisma.surplusShare.findMany({ where: { runId: r.body.id } });
      expect(Object.fromEntries(shares.map((s) => [s.userId, s.amountCents]))).toEqual(
        amounts(preview),
      );
      const tx = await t.prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'SURPLUS_DISTRIBUTION' },
        include: { postings: true },
      });
      expect(tx.reference).toBe(r.body.id);
      const debit = tx.postings
        .filter((p) => p.direction === 'DEBIT')
        .reduce((s, p) => s + p.amountCents, 0);
      const credit = tx.postings
        .filter((p) => p.direction === 'CREDIT')
        .reduce((s, p) => s + p.amountCents, 0);
      expect(debit).toBe(10_000_00);
      expect(credit).toBe(10_000_00);
      const wallet = (await t.get('/driver/wallet', b.token)).body;
      expect(wallet.balanceCents).toBe(amounts(preview)[b.id]);
      expect(wallet.quotas).toBe(30); // as cotas não mudam
    });

    it('cada sócio vê o que recebeu', async () => {
      await close(await closeBody());
      const mine = (await t.get('/association/surplus', a.token)).body;
      expect(mine).toEqual([
        expect.objectContaining({ year: Y, quotas: 10, useCents: 100_00, useWeightPercent: 50 }),
      ]);
      expect(mine[0].amountCents).toBeGreaterThan(0);
      expect((await t.get('/association/surplus', (await t.driver('Outro')).token)).body).toEqual(
        [],
      );
    });

    it('exige a simulação: checksum errado ou com valor diferente é recusado', async () => {
      const ok = await closeBody();
      expect((await close({ ...ok, checksum: 'a'.repeat(64) })).status).toBe(409);
      expect((await close({ ...ok, distributableCents: 10_000_01 })).status).toBe(409);
      expect((await close({ ...ok, useWeightPercent: 40 })).status).toBe(409);
      expect((await close({ ...ok, checksum: 'curto' })).status).toBe(400);
      expect((await close({ year: Y, distributableCents: 10_000_00 })).status).toBe(400);
      expect(await t.prisma.surplusRun.count()).toBe(0);
    });

    it('se os dados mudaram depois da simulação, manda simular de novo', async () => {
      const ok = await closeBody();
      await delivered(a, 50_00); // novo uso no ano
      const r = await close(ok);
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/Simule de novo/);
      expect(await t.prisma.surplusRun.count()).toBe(0);
    });

    it('só fecha ano que já terminou', async () => {
      const current = new Date().getFullYear();
      await t.giveQuotas(a.id, 1, new Date(Date.UTC(current, 0, 5)));
      const s = await simulate(sim({ year: current }));
      expect(s.status).toBe(200);
      const r = await close({ ...sim({ year: current }), checksum: s.body.checksum });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/não terminou/);
    });

    it('um ano só é fechado uma vez, mesmo com pedidos ao mesmo tempo', async () => {
      const ok = await closeBody();
      const rs = await Promise.all([close(ok), close(ok), close(ok)]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await t.prisma.surplusRun.count()).toBe(1);
      expect(
        await t.prisma.ledgerTransaction.count({ where: { kind: 'SURPLUS_DISTRIBUTION' } }),
      ).toBe(1);
      expect((await close(ok)).status).toBe(409);
      expect((await simulate()).body.alreadyClosed).toBe(true);
    });

    it('só admin fecha', async () => {
      expect((await close(await closeBody(), a)).status).toBe(403);
    });

    it('o fechamento é imutável: sobras e partes não mudam nem somem', async () => {
      const r = await close(await closeBody());
      const run = await t.prisma.surplusRun.findUniqueOrThrow({ where: { id: r.body.id } });
      const share = await t.prisma.surplusShare.findFirstOrThrow({ where: { runId: run.id } });
      await expect(
        t.prisma.surplusRun.update({ where: { id: run.id }, data: { distributableCents: 1 } }),
      ).rejects.toThrow();
      await expect(t.prisma.surplusRun.delete({ where: { id: run.id } })).rejects.toThrow();
      await expect(
        t.prisma.surplusShare.update({ where: { id: share.id }, data: { amountCents: 1 } }),
      ).rejects.toThrow();
      await expect(t.prisma.surplusShare.delete({ where: { id: share.id } })).rejects.toThrow();
    });

    it('lista os anos fechados para o admin', async () => {
      await close(await closeBody());
      const runs = (await t.get('/admin/surplus/runs', admin.token)).body;
      expect(runs).toEqual([
        expect.objectContaining({ year: Y, memberCount: 3, distributableCents: 10_000_00 }),
      ]);
    });

    it('uma parte que dá zero não gera lançamento inválido no ledger', async () => {
      // c tem 20 de 60 cotas mas peso de uso 100% e nenhum uso: parte 0.
      const body = await closeBody({ useWeightPercent: 100 });
      const r = await close(body);
      expect(r.status).toBe(200);
      expect(
        await t.prisma.surplusShare.count({ where: { runId: r.body.id, amountCents: 0 } }),
      ).toBe(1);
      expect(
        await t.prisma.ledgerPosting.count({ where: { account: `WORKER_BALANCE:${c.id}` } }),
      ).toBe(0);
    });
  });
});
