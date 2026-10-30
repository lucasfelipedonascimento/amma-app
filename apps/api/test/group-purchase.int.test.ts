import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxPurchasePartner, SANDBOX_PARTNER_PENDING_CENTS } from '../src/association/partner';
import { GroupPurchaseService } from '../src/association/group-purchase.service';
import { PurchaseRulesService } from '../src/association/purchase-rules.service';
import { TestApp, type TestUser } from './helpers';

const DAY = 86_400_000;

describe('compra coletiva: grupos, fila, aportes e contemplação', () => {
  let t: TestApp;
  let admin: TestUser;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let groupId: string;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
    a = await t.member('Ana Lima', 10);
    b = await t.member('Bruno Reis', 20);
    c = await t.member('Carla Dias', 2);
    groupId = (
      await t.post('/admin/purchase-groups', admin.token, {
        name: 'Motos 2027',
        vehicleType: 'MOTO',
        targetCents: 20_000_00,
      })
    ).body.id;
  });

  const join = (u: TestUser, id = groupId) => t.post(`/purchase-groups/${id}/join`, u.token);
  const pay = (u: TestUser, amountCents: number, extra: object = {}) =>
    t.post(`/purchase-groups/${groupId}/contributions`, u.token, { amountCents, ...extra });
  const detail = async (u: TestUser = a) =>
    (await t.get(`/purchase-groups/${groupId}`, u.token)).body;
  /** Recua a data de entrada na fila (tempo de espera). */
  const age = (u: TestUser, days: number) =>
    t.prisma.queueEntry.updateMany({
      where: { groupId, userId: u.id },
      data: { joinedAt: new Date(Date.now() - days * DAY) },
    });
  const award = () => t.post(`/admin/purchase-groups/${groupId}/award`, admin.token);

  describe('grupos', () => {
    it('só o admin cria e encerra grupos', async () => {
      const body = { name: 'Carros', vehicleType: 'CARRO', targetCents: 50_000_00 };
      expect((await t.post('/admin/purchase-groups', a.token, body)).status).toBe(403);
      expect((await t.post('/admin/purchase-groups', admin.token, body)).status).toBe(201);
      expect((await t.post(`/admin/purchase-groups/${groupId}/close`, a.token)).status).toBe(403);
    });

    it('valor-alvo e tipo de veículo inválidos', async () => {
      const post = (b: object) =>
        t.post('/admin/purchase-groups', admin.token, {
          name: 'Grupo',
          vehicleType: 'MOTO',
          targetCents: 1000,
          ...b,
        });
      expect((await post({ targetCents: 0 })).status).toBe(400);
      expect((await post({ targetCents: 10.5 })).status).toBe(400);
      expect((await post({ vehicleType: 'BICICLETA' })).status).toBe(400);
    });

    it('lista com valor arrecadado, tamanho da fila e a situação de cada sócio', async () => {
      await join(a);
      await pay(a, 10_000_00);
      const list = (await t.get('/purchase-groups', a.token)).body;
      expect(list).toEqual([
        expect.objectContaining({
          id: groupId,
          fundedCents: 10_000_00,
          queueSize: 1,
          myStatus: 'NA_FILA',
          status: 'ABERTO',
        }),
      ]);
      expect((await t.get('/purchase-groups', b.token)).body[0].myStatus).toBeNull();
    });

    it('grupo encerrado não aceita entrada nem aporte', async () => {
      await join(a);
      await t.post(`/admin/purchase-groups/${groupId}/close`, admin.token);
      expect((await join(b)).status).toBe(409);
      expect((await pay(a, 10_000_00)).status).toBe(409);
      expect((await award()).status).toBe(409);
    });
  });

  describe('entrar e sair da fila', () => {
    it('sócio entra; quem não tem cota (ou o mínimo da regra) não entra', async () => {
      expect((await join(a)).status).toBe(200);
      expect((await join(await t.driver('SemCota'))).status).toBe(403);
      expect((await join(await t.client())).status).toBe(403);
      await t.prisma.purchaseRulesVersion.create({ data: { rules: { minQuotas: 5 } } });
      expect((await join(c)).status).toBe(403); // 2 cotas < 5
      expect((await join(b)).status).toBe(200);
    });

    it('não entra duas vezes', async () => {
      await join(a);
      expect((await join(a)).status).toBe(409);
      expect(await t.prisma.queueEntry.count()).toBe(1);
    });

    it('sai da fila sem aportes; sair sem estar nela dá 404', async () => {
      expect((await t.post(`/purchase-groups/${groupId}/leave`, a.token)).status).toBe(404);
      await join(a);
      expect((await t.post(`/purchase-groups/${groupId}/leave`, a.token)).status).toBe(200);
      expect((await detail()).queue).toEqual([]);
    });

    it('com aportes confirmados não sai sozinho (a devolução é com a associação)', async () => {
      await join(a);
      await pay(a, 5_000_00);
      const r = await t.post(`/purchase-groups/${groupId}/leave`, a.token);
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/associação/);
      expect((await detail()).myStatus).toBe('NA_FILA');
    });

    it('quem sai e volta recomeça o tempo de fila', async () => {
      await join(a);
      await age(a, 100);
      await t.post(`/purchase-groups/${groupId}/leave`, a.token);
      await join(a);
      expect((await detail()).queue[0].daysInQueue).toBe(0);
    });
  });

  describe('fila por cotas e tempo', () => {
    it('ordena por pontos: cotas × 10 + dias × 1 (regra padrão)', async () => {
      await join(a); // 10 cotas → 100
      await join(b); // 20 cotas → 200
      await join(c); // 2 cotas → 20 + 300 dias
      await age(c, 300);
      const q = (await detail()).queue;
      expect(q.map((x: any) => [x.name, x.position, x.score])).toEqual([
        ['Carla', 1, 320],
        ['Bruno', 2, 200],
        ['Ana', 3, 100],
      ]);
      expect(q.find((x: any) => x.isMe).name).toBe('Ana');
    });

    it('empate de pontos: quem entrou antes fica na frente', async () => {
      await t.giveQuotas(a.id, 10); // a = 20 cotas, igual ao b
      await join(b);
      await age(b, 5);
      await join(a);
      await age(a, 5);
      await t.prisma.queueEntry.updateMany({
        where: { userId: a.id },
        data: { joinedAt: new Date(Date.now() - 5 * DAY + 60_000) },
      });
      expect((await detail()).queue.map((x: any) => x.name)).toEqual(['Bruno', 'Ana']);
    });

    it('mostra só o primeiro nome dos outros sócios', async () => {
      await join(a);
      const q = (await detail(b)).queue;
      expect(q[0].name).toBe('Ana');
      expect(JSON.stringify(q)).not.toMatch(/Lima|userId|phone|\+55/);
    });

    it('a regra decidida em assembleia muda a ordem da fila', async () => {
      await join(a); // 10 cotas, 0 dias
      await join(c); // 2 cotas, 60 dias
      await age(c, 60);
      expect((await detail()).queue[0].name).toBe('Ana'); // 100 x 80
      await t.prisma.purchaseRulesVersion.create({
        data: { rules: { quotaWeight: 1, dayWeight: 5 } },
      });
      const d = await detail();
      expect(d.rules).toMatchObject({ quotaWeight: 1, dayWeight: 5 });
      expect(d.queue[0].name).toBe('Carla'); // 302 x 10
    });

    it('quem perdeu as cotas mínimas sai do ranking (sem perder o lugar no registro)', async () => {
      await join(a);
      await join(b);
      await t.prisma.purchaseRulesVersion.create({ data: { rules: { minQuotas: 15 } } });
      expect((await detail()).queue.map((x: any) => x.name)).toEqual(['Bruno']);
    });
  });

  describe('aportes (registro, sem dinheiro real)', () => {
    beforeEach(() => join(a));

    it('o parceiro simulado aceita e o aporte vira lançamento no ledger', async () => {
      const r = await pay(a, 1_500_00);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        status: 'CONFIRMADO',
        amountCents: 1_500_00,
        partner: 'sandbox',
      });
      const tx = await t.prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'GROUP_CONTRIBUTION' },
        include: { postings: true },
      });
      expect(tx.reference).toBe(r.body.id);
      expect(tx.postings.map((p) => [p.account, p.direction, p.amountCents]).sort()).toEqual(
        [
          [`PARTNER_GROUP:${groupId}`, 'DEBIT', 1_500_00],
          [`MEMBER_GROUP:${groupId}:${a.id}`, 'CREDIT', 1_500_00],
        ].sort(),
      );
    });

    it('não mexe nos ganhos nem nas cotas do sócio', async () => {
      await pay(a, 1_500_00);
      expect((await t.get('/driver/wallet', a.token)).body).toMatchObject({
        balanceCents: 0,
        quotas: 10,
      });
    });

    it('soma os aportes do sócio e do grupo', async () => {
      await join(b);
      await pay(a, 1_000_00);
      await pay(a, 2_000_00);
      await pay(b, 500_00);
      const mine = (await t.get(`/purchase-groups/${groupId}/contributions`, a.token)).body;
      expect(mine.totalCents).toBe(3_000_00);
      expect(mine.items).toHaveLength(2);
      expect((await detail()).fundedCents).toBe(3_500_00);
    });

    it('o ledger inteiro continua balanceado', async () => {
      await pay(a, 1_000_00);
      await pay(a, 77_77);
      const rows = await t.prisma.ledgerPosting.groupBy({
        by: ['direction'],
        _sum: { amountCents: true },
      });
      const sum = (d: string) => rows.find((r) => r.direction === d)?._sum.amountCents ?? 0;
      expect(sum('DEBIT')).toBe(sum('CREDIT'));
    });

    it('abaixo do mínimo da regra: recusado antes de ir ao parceiro', async () => {
      const r = await pay(a, 49_99);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/mínimo/);
      expect(await t.prisma.contribution.count()).toBe(0);
    });

    it('o mínimo é o da regra em vigor, que a assembleia pode mudar', async () => {
      await t.prisma.purchaseRulesVersion.create({
        data: { rules: { minContributionCents: 20_000 } },
      });
      expect((await pay(a, 100_00)).status).toBe(400);
      expect((await pay(a, 200_00)).status).toBe(201);
    });

    it('parceiro recusa (acima do limite): fica registrado como RECUSADO, sem ledger', async () => {
      const r = await pay(a, 10_000_01);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        status: 'RECUSADO',
        declineReason: 'Valor acima do limite do parceiro',
      });
      expect(
        await t.prisma.ledgerTransaction.count({ where: { kind: 'GROUP_CONTRIBUTION' } }),
      ).toBe(0);
      expect((await detail()).fundedCents).toBe(0);
    });

    it('parceiro fora do ar (R$ 13,13): 503 e nada é gravado; tentar de novo funciona', async () => {
      expect((await pay(a, 13_13)).status).toBe(400); // abaixo do mínimo padrão: muda a regra para testar o parceiro
      await t.prisma.purchaseRulesVersion.create({
        data: { rules: { minContributionCents: 1000 } },
      });
      const r = await pay(a, 13_13);
      expect(r.status).toBe(503);
      expect(await t.prisma.contribution.count()).toBe(0);
      expect(
        await t.prisma.ledgerTransaction.count({ where: { kind: 'GROUP_CONTRIBUTION' } }),
      ).toBe(0);
      expect((await pay(a, 13_14)).status).toBe(201);
    });

    it('a mesma chave de idempotência registra uma única vez (duplo toque)', async () => {
      const key = 'toque-duplo-0001';
      const rs = await Promise.all([
        pay(a, 100_00, { idempotencyKey: key }),
        pay(a, 100_00, { idempotencyKey: key }),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 201]);
      expect(rs[0]!.body.id).toBe(rs[1]!.body.id);
      expect((await pay(a, 100_00, { idempotencyKey: key })).body.id).toBe(rs[0]!.body.id);
      expect(await t.prisma.contribution.count()).toBe(1);
      expect(
        await t.prisma.ledgerTransaction.count({ where: { kind: 'GROUP_CONTRIBUTION' } }),
      ).toBe(1);
    });

    it('chaves diferentes são aportes diferentes', async () => {
      await pay(a, 100_00, { idempotencyKey: 'chave-aaaa-0001' });
      await pay(a, 100_00, { idempotencyKey: 'chave-aaaa-0002' });
      expect(await t.prisma.contribution.count()).toBe(2);
    });

    it('só quem está na fila faz aporte', async () => {
      expect((await pay(b, 100_00)).status).toBe(403);
      expect((await pay(await t.client(), 100_00)).status).toBe(403);
    });

    it('valor inválido', async () => {
      expect((await pay(a, 0)).status).toBe(400);
      expect((await pay(a, 10.5)).status).toBe(400);
      expect((await pay(a, -5)).status).toBe(400);
    });

    it('o ledger não aceita editar nem apagar o aporte', async () => {
      await pay(a, 100_00);
      const tx = await t.prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'GROUP_CONTRIBUTION' },
      });
      await expect(t.prisma.ledgerTransaction.delete({ where: { id: tx.id } })).rejects.toThrow();
    });
  });

  describe('parceiro confirma depois (pendente, webhook e conciliação)', () => {
    beforeEach(() => join(a));
    const partner = () => t.app.get(GroupPurchaseService)['partner'] as SandboxPurchasePartner;
    const ledgerCount = () =>
      t.prisma.ledgerTransaction.count({ where: { kind: 'GROUP_CONTRIBUTION' } });
    const send = async (payload: object, signature?: string) => {
      const raw = JSON.stringify(payload);
      const res = await fetch(`${t.baseUrl}/partner/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-amma-signature': signature ?? partner().sign(raw),
        },
        body: raw,
      });
      return res.status;
    };
    const pending = async () => {
      const r = await pay(a, SANDBOX_PARTNER_PENDING_CENTS);
      expect(r.body.status).toBe('PENDENTE');
      const row = await t.prisma.contribution.findUniqueOrThrow({ where: { id: r.body.id } });
      return { id: r.body.id as string, ref: row.partnerRef! };
    };
    const confirmed = (ref: string, id = 'evt_1') => ({
      id,
      type: 'contribution.confirmed',
      partnerRef: ref,
    });

    it('pendente: aparece com instruções, não entra no ledger nem no total do grupo', async () => {
      const r = await pay(a, SANDBOX_PARTNER_PENDING_CENTS);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'PENDENTE' });
      expect(r.body.instructions).toMatch(/^PAGUE-SIMULADO/);
      expect(await ledgerCount()).toBe(0);
      expect((await detail()).fundedCents).toBe(0);
      expect(
        (await t.get(`/purchase-groups/${groupId}/contributions`, a.token)).body.totalCents,
      ).toBe(0);
    });

    it('aviso assinado confirma: lança no ledger uma vez só, mesmo reenviado', async () => {
      const p = await pending();
      expect(await send(confirmed(p.ref))).toBe(200);
      expect(await send(confirmed(p.ref))).toBe(200);
      expect(await send(confirmed(p.ref, 'evt_2'))).toBe(200);
      const c = await t.prisma.contribution.findUniqueOrThrow({ where: { id: p.id } });
      expect(c.status).toBe('CONFIRMADO');
      expect(c.confirmedAt).not.toBeNull();
      expect(c.instructions).toBeNull();
      expect(await ledgerCount()).toBe(1);
      expect((await detail()).fundedCents).toBe(SANDBOX_PARTNER_PENDING_CENTS);
    });

    it('aviso de recusa: fica recusado, com o motivo, e nada entra no ledger', async () => {
      const p = await pending();
      await send({
        id: 'e',
        type: 'contribution.declined',
        partnerRef: p.ref,
        reason: 'Boleto vencido',
      });
      const c = await t.prisma.contribution.findUniqueOrThrow({ where: { id: p.id } });
      expect(c).toMatchObject({ status: 'RECUSADO', declineReason: 'Boleto vencido' });
      expect(await ledgerCount()).toBe(0);
    });

    it('sem assinatura válida: 401 e nada muda', async () => {
      const p = await pending();
      expect(await send(confirmed(p.ref), 'a'.repeat(64))).toBe(401);
      expect(await send(confirmed(p.ref), 'curta')).toBe(401);
      expect((await t.prisma.contribution.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
        'PENDENTE',
      );
    });

    it('avisos que não interessam ou de aporte desconhecido: 200 e nada muda', async () => {
      const p = await pending();
      expect(await send({ id: 'x', type: 'outro.evento', partnerRef: p.ref })).toBe(200);
      expect(await send(confirmed('part_sbx_nao-existe', 'evt_9'))).toBe(200);
      expect((await t.prisma.contribution.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
        'PENDENTE',
      );
    });

    it('confirmação depois da recusa (ou o contrário) não muda o que já foi decidido', async () => {
      const p = await pending();
      await send({ id: 'e1', type: 'contribution.declined', partnerRef: p.ref });
      await send(confirmed(p.ref, 'e2'));
      expect((await t.prisma.contribution.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
        'RECUSADO',
      );
      expect(await ledgerCount()).toBe(0);
    });

    it('avisos em paralelo lançam o aporte uma vez só', async () => {
      const p = await pending();
      await Promise.all(Array.from({ length: 8 }, (_, i) => send(confirmed(p.ref, `evt_${i}`))));
      expect(await ledgerCount()).toBe(1);
    });

    it('conciliação: aviso perdido é resolvido perguntando ao parceiro', async () => {
      const p = await pending();
      const svc = t.app.get(GroupPurchaseService);
      expect(await svc.reconcilePending(0)).toBe(0); // parceiro ainda não decidiu
      partner().resolve(p.ref, 'CONFIRMADO');
      expect(await svc.reconcilePending(0)).toBe(1);
      expect(await svc.reconcilePending(0)).toBe(0);
      expect((await t.prisma.contribution.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
        'CONFIRMADO',
      );
      expect(await ledgerCount()).toBe(1);
    });

    it('conciliação só olha aportes parados há tempo suficiente', async () => {
      const p = await pending();
      partner().resolve(p.ref, 'CONFIRMADO');
      expect(await t.app.get(GroupPurchaseService).reconcilePending(60_000)).toBe(0);
    });

    it('com aporte pendente o sócio não sai da fila', async () => {
      await pending();
      expect((await t.post(`/purchase-groups/${groupId}/leave`, a.token)).status).toBe(409);
    });
  });

  describe('contemplação', () => {
    it('só admin contempla', async () => {
      expect((await t.post(`/admin/purchase-groups/${groupId}/award`, a.token)).status).toBe(403);
    });

    it('sem aportes que cubram um veículo, não contempla', async () => {
      await join(a);
      await pay(a, 9_999_00);
      const r = await award();
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/não cobrem/);
    });

    it('contempla o primeiro da fila quando os aportes cobrem um veículo', async () => {
      await join(a);
      await join(b);
      await pay(a, 10_000_00);
      await pay(b, 10_000_00);
      const r = await award();
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        userId: b.id,
        position: 1,
        score: 200,
        fundedCents: 20_000_00,
      });
      const d = await detail();
      expect(d.awards).toEqual([expect.objectContaining({ name: 'Bruno', position: 1 })]);
      expect(d.queue.map((x: any) => x.name)).toEqual(['Ana']); // quem foi contemplado sai da fila
      expect(d.availableUnits).toBe(0);
      expect((await detail(b)).myStatus).toBe('CONTEMPLADO');
    });

    it('cada veículo exige mais aportes: a segunda contemplação espera o valor de outro', async () => {
      await join(a);
      await join(b);
      await pay(a, 10_000_00);
      await pay(b, 10_000_00);
      await award();
      expect((await award()).status).toBe(409);
      await pay(a, 10_000_00);
      await pay(a, 10_000_00);
      const r = await award();
      expect(r.status).toBe(200);
      expect(r.body.userId).toBe(a.id);
    });

    it('contemplações simultâneas não gastam o mesmo dinheiro duas vezes', async () => {
      await join(a);
      await join(b);
      await pay(a, 10_000_00);
      await pay(b, 10_000_00);
      const rs = await Promise.all([award(), award(), award()]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await t.prisma.groupAward.count()).toBe(1);
    });

    it('fila vazia: nada a contemplar', async () => {
      await join(a);
      await pay(a, 10_000_00);
      await pay(a, 10_000_00);
      await t.prisma.purchaseRulesVersion.create({ data: { rules: { minQuotas: 50 } } });
      expect((await award()).status).toBe(409);
    });

    it('a contemplação não pode ser apagada nem editada', async () => {
      await join(a);
      await pay(a, 10_000_00);
      await pay(a, 10_000_00);
      await award();
      const aw = await t.prisma.groupAward.findFirstOrThrow();
      await expect(t.prisma.groupAward.delete({ where: { id: aw.id } })).rejects.toThrow();
      await expect(
        t.prisma.groupAward.update({ where: { id: aw.id }, data: { position: 9 } }),
      ).rejects.toThrow();
    });

    it('quem foi contemplado continua podendo aportar, mas não sai da fila sozinho', async () => {
      await join(a);
      await pay(a, 10_000_00);
      await pay(a, 10_000_00);
      await award();
      expect((await pay(a, 100_00)).status).toBe(201);
      expect((await t.post(`/purchase-groups/${groupId}/leave`, a.token)).status).toBe(409);
      expect((await join(a)).status).toBe(409);
    });
  });

  it('excluir a conta tira o sócio da fila e mantém os aportes registrados', async () => {
    await join(a);
    await pay(a, 100_00);
    expect((await t.req('DELETE', '/me', a.token)).status).toBeLessThan(300);
    expect((await detail(b)).queue).toEqual([]);
    expect(await t.prisma.contribution.count()).toBe(1);
    expect((await detail(b)).fundedCents).toBe(100_00);
  });

  it('o ranking usa a regra vigente via PurchaseRulesService (padrão do código sem versão)', async () => {
    expect(await t.app.get(PurchaseRulesService).current()).toEqual({
      quotaWeight: 10,
      dayWeight: 1,
      minQuotas: 1,
      minContributionCents: 5000,
    });
  });
});
