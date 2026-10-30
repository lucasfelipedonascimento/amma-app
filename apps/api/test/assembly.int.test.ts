import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp, type TestUser } from './helpers';

const HOURS = 3_600_000;

describe('assembleia: propostas, voto, fechamento e histórico', () => {
  let t: TestApp;
  let admin: TestUser;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
    a = await t.member('Ana', 3);
    b = await t.member('Bruno', 10);
    c = await t.member('Carla', 1);
  });

  const closesIn = (hours: number) => new Date(Date.now() + hours * HOURS).toISOString();
  const propose = async (extra: object = {}) =>
    (
      await t.post('/admin/assembly/proposals', admin.token, {
        kind: 'GERAL',
        title: 'Reajustar a taxa de associação',
        description: 'Proposta para discutir o reajuste anual.',
        closesAt: closesIn(48),
        ...extra,
      })
    ).body;
  const vote = (u: TestUser, id: string, choice: string) =>
    t.put(`/assembly/proposals/${id}/vote`, u.token, { choice });
  const get = (u: TestUser, id: string) => t.get(`/assembly/proposals/${id}`, u.token);

  /** Faz o prazo vencer sem esperar o relógio (desliga o gatilho só neste ajuste). */
  async function expire(id: string) {
    await t.prisma.$executeRawUnsafe('ALTER TABLE "Proposal" DISABLE TRIGGER "Proposal_guard"');
    try {
      await t.prisma.$executeRawUnsafe(
        `UPDATE "Proposal" SET "opensAt" = now() - interval '3 days', "closesAt" = now() - interval '1 second' WHERE id = '${id}'`,
      );
    } finally {
      await t.prisma.$executeRawUnsafe('ALTER TABLE "Proposal" ENABLE TRIGGER "Proposal_guard"');
    }
  }

  describe('criar proposta', () => {
    it('só o admin cria; sócio e passageiro não', async () => {
      const body = {
        kind: 'GERAL',
        title: 'Título válido',
        description: 'Descrição válida.',
        closesAt: closesIn(48),
      };
      expect((await t.post('/admin/assembly/proposals', a.token, body)).status).toBe(403);
      expect(
        (await t.post('/admin/assembly/proposals', (await t.client()).token, body)).status,
      ).toBe(403);
      expect((await t.post('/admin/assembly/proposals', admin.token, body)).status).toBe(201);
    });

    it('abre agora, guarda quantos sócios podiam votar e começa ABERTA sem resultado', async () => {
      const p = await propose({ quorumPercent: 50 });
      expect(p).toMatchObject({
        status: 'ABERTA',
        eligibleCount: 3,
        quorumPercent: 50,
        requiredVotes: 2,
        result: null,
        myVote: null,
      });
    });

    it('só conta como apto quem tem cota: motorista sem cota e conta excluída ficam de fora', async () => {
      await t.driver('SemCota');
      const gone = await t.member('Saiu', 4);
      await t.prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      expect((await propose()).eligibleCount).toBe(3);
    });

    it('prazo: mínimo 24 horas, máximo 60 dias', async () => {
      expect(
        (
          await t.post('/admin/assembly/proposals', admin.token, {
            kind: 'GERAL',
            title: 'Título',
            description: 'Descrição longa.',
            closesAt: closesIn(23),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await t.post('/admin/assembly/proposals', admin.token, {
            kind: 'GERAL',
            title: 'Título',
            description: 'Descrição longa.',
            closesAt: closesIn(61 * 24),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await t.post('/admin/assembly/proposals', admin.token, {
            kind: 'GERAL',
            title: 'Título',
            description: 'Descrição longa.',
            closesAt: closesIn(-5),
          })
        ).status,
      ).toBe(400);
    });

    it('proposta de regra exige uma alteração válida; proposta geral não leva alteração', async () => {
      const base = {
        title: 'Mudar a fila',
        description: 'Mudar o mínimo de cotas.',
        closesAt: closesIn(48),
      };
      const post = (body: object) =>
        t.post('/admin/assembly/proposals', admin.token, { ...base, ...body });
      expect((await post({ kind: 'REGRA_COMPRA_COLETIVA' })).status).toBe(400);
      expect((await post({ kind: 'REGRA_COMPRA_COLETIVA', ruleChange: { cor: 1 } })).status).toBe(
        400,
      );
      expect(
        (await post({ kind: 'REGRA_COMPRA_COLETIVA', ruleChange: { minQuotas: -3 } })).status,
      ).toBe(400);
      expect(
        (
          await post({
            kind: 'REGRA_COMPRA_COLETIVA',
            ruleChange: { quotaWeight: 0, dayWeight: 0 },
          })
        ).status,
      ).toBe(400);
      expect((await post({ kind: 'GERAL', ruleChange: { minQuotas: 5 } })).status).toBe(400);
      expect(
        (await post({ kind: 'REGRA_COMPRA_COLETIVA', ruleChange: { minQuotas: 5 } })).status,
      ).toBe(201);
    });
  });

  describe('votar', () => {
    it('sócio vota e vê o próprio voto', async () => {
      const p = await propose();
      const r = await vote(a, p.id, 'SIM');
      expect(r.status).toBe(200);
      expect(r.body.myVote).toBe('SIM');
      expect((await get(b, p.id)).body.myVote).toBeNull();
    });

    it('quem não é sócio (motorista sem cota, passageiro) não vota', async () => {
      const p = await propose();
      expect((await vote(await t.driver('SemCota'), p.id, 'SIM')).status).toBe(403);
      expect((await vote(await t.client(), p.id, 'SIM')).status).toBe(403);
      expect(await t.prisma.vote.count()).toBe(0);
    });

    it('1 sócio = 1 voto, qualquer que seja o nível ou o número de cotas', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM'); // 3 cotas
      await vote(b, p.id, 'NAO'); // 10 cotas
      await vote(a, p.id, 'SIM');
      await vote(a, p.id, 'SIM');
      expect(await t.prisma.vote.count({ where: { proposalId: p.id } })).toBe(2);
      await expire(p.id);
      expect((await get(a, p.id)).body.result).toMatchObject({ yes: 1, no: 1, total: 2 });
    });

    it('muda o voto até o fechamento, e só vale o último', async () => {
      const p = await propose();
      await vote(a, p.id, 'NAO');
      await vote(a, p.id, 'ABSTENCAO');
      const last = await vote(a, p.id, 'SIM');
      expect(last.body.myVote).toBe('SIM');
      expect(await t.prisma.vote.count({ where: { proposalId: p.id } })).toBe(1);
      await expire(p.id);
      expect((await get(a, p.id)).body.result).toMatchObject({ yes: 1, no: 0, abstain: 0 });
    });

    it('o histórico guarda cada voto e cada mudança, na ordem, e repetir a mesma escolha não duplica', async () => {
      const p = await propose();
      await vote(a, p.id, 'NAO');
      await vote(a, p.id, 'NAO');
      await vote(a, p.id, 'SIM');
      const h = (await t.get(`/assembly/proposals/${p.id}/my-votes`, a.token)).body;
      expect(h.map((x: any) => [x.action, x.choice])).toEqual([
        ['VOTOU', 'NAO'],
        ['MUDOU', 'SIM'],
      ]);
    });

    it('o sócio só vê o próprio histórico, nunca o de outros', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      await vote(b, p.id, 'NAO');
      expect((await t.get(`/assembly/proposals/${p.id}/my-votes`, a.token)).body).toHaveLength(1);
      expect((await t.get(`/assembly/proposals/${p.id}/my-votes`, c.token)).body).toEqual([]);
    });

    it('escolha inválida e proposta inexistente', async () => {
      const p = await propose();
      expect((await vote(a, p.id, 'TALVEZ')).status).toBe(400);
      expect((await vote(a, '00000000-0000-4000-8000-000000000000', 'SIM')).status).toBe(404);
      expect((await t.put('/assembly/proposals/xyz/vote', a.token, { choice: 'SIM' })).status).toBe(
        400,
      );
    });

    it('a contagem não aparece enquanto a votação está aberta', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      const r = (await get(b, p.id)).body;
      expect(r.status).toBe('ABERTA');
      expect(r.result).toBeNull();
      expect(JSON.stringify((await t.get('/assembly/proposals', b.token)).body)).not.toMatch(
        /"yes"/,
      );
    });

    it('votos simultâneos do mesmo sócio resultam em um só voto', async () => {
      const p = await propose();
      const rs = await Promise.all([
        vote(a, p.id, 'SIM'),
        vote(a, p.id, 'NAO'),
        vote(a, p.id, 'SIM'),
      ]);
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(await t.prisma.vote.count({ where: { proposalId: p.id, voterId: a.id } })).toBe(1);
    });
  });

  describe('fechamento e resultado', () => {
    it('mais SIM que NAO: APROVADA, com a apuração e o resumo dos votos', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      await vote(b, p.id, 'SIM');
      await vote(c, p.id, 'NAO');
      await expire(p.id);
      const r = (await get(a, p.id)).body;
      expect(r.status).toBe('APROVADA');
      expect(r.result).toMatchObject({ yes: 2, no: 1, abstain: 0, total: 3 });
      const sorted = [a, b, c].map((u) => u.id).sort();
      const choice = (id: string) => (id === c.id ? 'NAO' : 'SIM');
      const digest = createHash('sha256')
        .update(sorted.map((id) => `${id}:${choice(id)}`).join('\n'))
        .digest('hex');
      expect(r.result.ballotDigest).toBe(digest);
    });

    it('empate é REJEITADA; abstenção não conta para a maioria', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      await vote(b, p.id, 'NAO');
      await vote(c, p.id, 'ABSTENCAO');
      await expire(p.id);
      expect((await get(a, p.id)).body).toMatchObject({
        status: 'REJEITADA',
        result: { abstain: 1 },
      });
    });

    it('sem quórum não decide, mesmo com todos os votos SIM', async () => {
      const p = await propose({ quorumPercent: 100 });
      await vote(a, p.id, 'SIM');
      await vote(b, p.id, 'SIM');
      await expire(p.id);
      expect((await get(a, p.id)).body.status).toBe('SEM_QUORUM');
    });

    it('ninguém votou: SEM_QUORUM', async () => {
      const p = await propose();
      await expire(p.id);
      expect((await get(a, p.id)).body).toMatchObject({
        status: 'SEM_QUORUM',
        result: { total: 0 },
      });
    });

    it('depois do prazo ninguém vota nem muda o voto', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      await expire(p.id);
      const late = await vote(b, p.id, 'SIM');
      expect(late.status).toBe(409);
      expect((await vote(a, p.id, 'NAO')).status).toBe(409);
      expect((await get(a, p.id)).body.result).toMatchObject({ yes: 1, no: 0, total: 1 });
    });

    it('fecha sozinha ao ser lida e pela rotina, sem repetir', async () => {
      const p = await propose();
      const q = await propose({ title: 'Outra proposta' });
      await vote(a, p.id, 'SIM');
      await expire(p.id);
      await expire(q.id);
      const list = (await t.get('/assembly/proposals?filter=encerradas', a.token)).body;
      expect(list.map((x: any) => x.id).sort()).toEqual([p.id, q.id].sort());
      expect((await t.get('/assembly/proposals?filter=abertas', a.token)).body).toEqual([]);
      const first = await t.prisma.proposal.findUniqueOrThrow({ where: { id: p.id } });
      expect(
        await t.app
          .get((await import('../src/association/assembly.service')).AssemblyService)
          .closeDue(),
      ).toBe(0);
      const again = await t.prisma.proposal.findUniqueOrThrow({ where: { id: p.id } });
      expect(again.closedAt).toEqual(first.closedAt);
    });

    it('vários fechamentos ao mesmo tempo aplicam a regra uma única vez', async () => {
      const { AssemblyService } = await import('../src/association/assembly.service');
      const p = await propose({ kind: 'REGRA_COMPRA_COLETIVA', ruleChange: { minQuotas: 4 } });
      await vote(a, p.id, 'SIM');
      await expire(p.id);
      const svc = t.app.get(AssemblyService);
      const results = await Promise.all([
        svc.finalize(p.id),
        svc.finalize(p.id),
        svc.finalize(p.id),
        svc.closeDue(),
      ]);
      expect(await t.prisma.purchaseRulesVersion.count()).toBe(1);
      expect(results.filter((r) => r === true)).toHaveLength(1);
    });

    it('voto de quem excluiu a conta continua valendo na apuração', async () => {
      const p = await propose();
      const gone = await t.member('Saiu', 2);
      await vote(gone, p.id, 'SIM');
      expect((await t.req('DELETE', '/me', gone.token)).status).toBeLessThan(300);
      await expire(p.id);
      expect((await get(a, p.id)).body.result).toMatchObject({ yes: 1, total: 1 });
    });
  });

  describe('regras da compra coletiva decididas em votação', () => {
    const currentRules = async () => {
      const { PurchaseRulesService } = await import('../src/association/purchase-rules.service');
      return t.app.get(PurchaseRulesService).current();
    };

    it('aprovada: vira uma nova versão das regras, ligada à proposta', async () => {
      const p = await propose({
        kind: 'REGRA_COMPRA_COLETIVA',
        ruleChange: { minQuotas: 5, dayWeight: 3 },
      });
      await vote(a, p.id, 'SIM');
      await vote(b, p.id, 'SIM');
      await expire(p.id);
      const r = (await get(a, p.id)).body;
      expect(r.status).toBe('APROVADA');
      expect(r.result.appliedRulesVersion).toBeTruthy();
      expect(await currentRules()).toMatchObject({ minQuotas: 5, dayWeight: 3, quotaWeight: 10 });
      const v = await t.prisma.purchaseRulesVersion.findFirstOrThrow();
      expect(v.proposalId).toBe(p.id);
    });

    it('rejeitada ou sem quórum: as regras não mudam', async () => {
      const p = await propose({ kind: 'REGRA_COMPRA_COLETIVA', ruleChange: { minQuotas: 5 } });
      await vote(a, p.id, 'NAO');
      await expire(p.id);
      expect((await get(a, p.id)).body.result.appliedRulesVersion).toBeNull();
      const q = await propose({
        kind: 'REGRA_COMPRA_COLETIVA',
        ruleChange: { minQuotas: 6 },
        quorumPercent: 100,
      });
      await vote(a, q.id, 'SIM');
      await expire(q.id);
      expect(await t.prisma.purchaseRulesVersion.count()).toBe(0);
      expect((await currentRules()).minQuotas).toBe(1);
    });

    it('a mudança é parcial: o que não foi proposto continua como estava', async () => {
      const p = await propose({ kind: 'REGRA_COMPRA_COLETIVA', ruleChange: { quotaWeight: 20 } });
      await vote(a, p.id, 'SIM');
      await expire(p.id);
      await get(a, p.id);
      expect(await currentRules()).toEqual({
        quotaWeight: 20,
        dayWeight: 1,
        minQuotas: 1,
        minContributionCents: 5000,
      });
    });
  });

  describe('histórico imutável (garantias do banco)', () => {
    it('proposta encerrada não muda nem some', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      await expire(p.id);
      await get(a, p.id);
      await expect(
        t.prisma.proposal.update({ where: { id: p.id }, data: { status: 'REJEITADA' } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.proposal.update({ where: { id: p.id }, data: { yesCount: 99 } }),
      ).rejects.toThrow();
      await expect(t.prisma.proposal.delete({ where: { id: p.id } })).rejects.toThrow();
    });

    it('proposta aberta só muda no fechamento: título e prazo ficam como foram votados', async () => {
      const p = await propose();
      await expect(
        t.prisma.proposal.update({ where: { id: p.id }, data: { title: 'Outro título' } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.proposal.update({
          where: { id: p.id },
          data: { closesAt: new Date(Date.now() + 90 * HOURS) },
        }),
      ).rejects.toThrow();
    });

    it('voto não pode ser apagado, e depois do fechamento nem alterado ou inserido', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      const v = await t.prisma.vote.findFirstOrThrow({ where: { proposalId: p.id } });
      await expect(t.prisma.vote.delete({ where: { id: v.id } })).rejects.toThrow();
      await expire(p.id);
      await get(a, p.id);
      await expect(
        t.prisma.vote.update({ where: { id: v.id }, data: { choice: 'NAO' } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.vote.create({ data: { proposalId: p.id, voterId: b.id, choice: 'SIM' } }),
      ).rejects.toThrow();
    });

    it('o registro de votos é somente inserção', async () => {
      const p = await propose();
      await vote(a, p.id, 'SIM');
      const rec = await t.prisma.voteRecord.findFirstOrThrow();
      await expect(
        t.prisma.voteRecord.update({ where: { id: rec.id }, data: { choice: 'NAO' } }),
      ).rejects.toThrow();
      await expect(t.prisma.voteRecord.delete({ where: { id: rec.id } })).rejects.toThrow();
    });

    it('versões das regras são somente inserção', async () => {
      const p = await propose({ kind: 'REGRA_COMPRA_COLETIVA', ruleChange: { minQuotas: 2 } });
      await vote(a, p.id, 'SIM');
      await expire(p.id);
      await get(a, p.id);
      const v = await t.prisma.purchaseRulesVersion.findFirstOrThrow();
      await expect(
        t.prisma.purchaseRulesVersion.update({ where: { id: v.id }, data: { rules: {} } }),
      ).rejects.toThrow();
      await expect(t.prisma.purchaseRulesVersion.delete({ where: { id: v.id } })).rejects.toThrow();
    });
  });
});
