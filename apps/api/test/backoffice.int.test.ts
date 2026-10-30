import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { near, TestApp, type TestUser } from './helpers';

describe('painel admin: acesso por papel', () => {
  let t: TestApp;
  let admin: TestUser;
  let member: TestUser;
  let plainDriver: TestUser;
  let client: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
    member = await t.member('Sócia', 3);
    plainDriver = await t.driver('Sem cotas');
    client = await t.client();
  });

  it('/panel/me devolve os papéis de painel de cada pessoa', async () => {
    expect((await t.get('/panel/me', admin.token)).body.panelRoles).toEqual(['ADMIN']);
    expect((await t.get('/panel/me', member.token)).body.panelRoles).toEqual(['SOCIO']);
    expect((await t.get('/panel/me', plainDriver.token)).body.panelRoles).toEqual([]);
    expect((await t.get('/panel/me', client.token)).body.panelRoles).toEqual([]);
    expect((await t.get('/panel/me')).status).toBe(401);
  });

  it('sócio lê assembleias, compra coletiva e orçamento; admin também', async () => {
    for (const path of ['/panel/assembly/proposals', '/panel/purchase-groups', '/panel/budget']) {
      expect((await t.get(path, member.token)).status, path).toBe(200);
      expect((await t.get(path, admin.token)).status, path).toBe(200);
    }
  });

  it('quem não é sócio nem admin não lê nada do painel', async () => {
    for (const path of ['/panel/assembly/proposals', '/panel/purchase-groups', '/panel/budget'])
      for (const u of [plainDriver, client])
        expect((await t.get(path, u.token)).status, path).toBe(403);
  });

  it('sócio não acessa nada de /admin (nem leitura)', async () => {
    for (const path of [
      '/admin/overview',
      '/admin/drivers',
      '/admin/merchants',
      '/admin/users',
      '/admin/blocks',
      '/admin/audit',
    ])
      expect((await t.get(path, member.token)).status, path).toBe(403);
    expect(
      (
        await t.post('/admin/budget/entries', member.token, {
          kind: 'DESPESA',
          category: 'JURIDICO',
          description: 'tentativa de sócio',
          amountCents: 100,
          occurredOn: '2026-10-01',
        })
      ).status,
    ).toBe(403);
  });

  it('o sócio vê o orçamento sem saber quem lançou', async () => {
    await t.post('/admin/budget/entries', admin.token, {
      kind: 'DESPESA',
      category: 'JURIDICO',
      description: 'Parecer jurídico',
      amountCents: 5000,
      occurredOn: '2026-10-01',
    });
    const year = new Date().getUTCFullYear();
    const asMember = (await t.get(`/panel/budget?year=${year}`, member.token)).body;
    const asAdmin = (await t.get(`/panel/budget?year=${year}`, admin.token)).body;
    expect(asMember.entries[0].createdByName).toBeUndefined();
    expect(asAdmin.entries[0].createdByName).toBe('Admin');
  });
});

describe('bloqueios, recurso e auditoria', () => {
  let t: TestApp;
  let admin: TestUser;
  let admin2: TestUser;
  let driver: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
    admin2 = await t.admin();
    driver = await t.driver('Maria');
  });

  const block = (reason = 'Documento do veículo falsificado') =>
    t.post(`/admin/users/${driver.id}/block`, admin.token, { reason });

  it('bloqueio exige motivo e não vale contra si mesmo ou outro admin', async () => {
    expect((await block('curto')).status).toBe(400);
    expect(
      (await t.post(`/admin/users/${admin.id}/block`, admin.token, { reason: 'x'.repeat(20) }))
        .status,
    ).toBe(403);
    expect(
      (await t.post(`/admin/users/${admin2.id}/block`, admin.token, { reason: 'x'.repeat(20) }))
        .status,
    ).toBe(403);
    expect(
      (await t.post(`/admin/users/${driver.id}/block`, driver.token, { reason: 'x'.repeat(20) }))
        .status,
    ).toBe(403);
  });

  it('conta bloqueada é barrada em tudo, menos no direito de ver o motivo e recorrer', async () => {
    await t.online(driver, near(100));
    const b = await block();
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ status: 'ATIVO', reason: 'Documento do veículo falsificado' });
    expect(await t.prisma.driverPresence.findFirst({ where: { userId: driver.id } })).toMatchObject(
      { online: false },
    );

    const denied = await t.get('/association/me', driver.token);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ACCOUNT_BLOCKED');
    expect((await t.get('/me', driver.token)).status).toBe(200);

    const mine = (await t.get('/me/block', driver.token)).body;
    expect(mine).toMatchObject({ blocked: true, status: 'ATIVO', canAppeal: true });
    expect(mine.reason).toBe('Documento do veículo falsificado');
  });

  it('só um bloqueio em vigor por pessoa', async () => {
    await block();
    expect((await block('Outro motivo bem longo')).status).toBe(409);
  });

  it('recurso: uma vez, com texto; só outro admin decide; aceito libera a conta', async () => {
    const id = (await block()).body.id;
    expect((await t.post('/me/block/appeal', driver.token, { text: 'curto' })).status).toBe(400);
    const sent = await t.post('/me/block/appeal', driver.token, {
      text: 'O documento é meu, segue o original novo.',
    });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('EM_RECURSO');
    expect(
      (await t.post('/me/block/appeal', driver.token, { text: 'tentando de novo aqui' })).status,
    ).toBe(409);

    const queue = (await t.get('/admin/blocks?status=EM_RECURSO', admin.token)).body;
    expect(queue).toHaveLength(1);
    expect(queue[0].appealText).toContain('documento é meu');

    const same = await t.post(`/admin/blocks/${id}/appeal-decision`, admin.token, {
      decision: 'ACEITO',
      reason: 'Documento conferido',
    });
    expect(same.status).toBe(403);
    expect(
      (
        await t.post(`/admin/blocks/${id}/appeal-decision`, admin2.token, {
          decision: 'ACEITO',
          reason: 'curto',
        })
      ).status,
    ).toBe(400);
    const ok = await t.post(`/admin/blocks/${id}/appeal-decision`, admin2.token, {
      decision: 'ACEITO',
      reason: 'Documento conferido presencialmente',
    });
    expect(ok.body.status).toBe('REVOGADO');
    expect((await t.get('/association/me', driver.token)).status).toBe(200);
    expect((await t.get('/me/block', driver.token)).body.blocked).toBe(false);
    // decidir de novo não vale
    expect(
      (
        await t.post(`/admin/blocks/${id}/appeal-decision`, admin2.token, {
          decision: 'NEGADO',
          reason: 'Tentativa dupla',
        })
      ).status,
    ).toBe(409);
  });

  it('recurso negado mantém o bloqueio, com a resposta visível, e não há novo recurso', async () => {
    const id = (await block()).body.id;
    await t.post('/me/block/appeal', driver.token, { text: 'Peço a revisão do bloqueio.' });
    await t.post(`/admin/blocks/${id}/appeal-decision`, admin2.token, {
      decision: 'NEGADO',
      reason: 'Documento continua inválido',
    });
    const mine = (await t.get('/me/block', driver.token)).body;
    expect(mine).toMatchObject({
      blocked: true,
      status: 'MANTIDO',
      canAppeal: false,
      decisionReason: 'Documento continua inválido',
    });
    expect(
      (await t.post('/me/block/appeal', driver.token, { text: 'Mais uma tentativa aqui' })).status,
    ).toBe(409);
    expect((await t.get('/association/me', driver.token)).status).toBe(403);
  });

  it('o admin revoga a qualquer momento, com motivo', async () => {
    const id = (await block()).body.id;
    expect(
      (await t.post(`/admin/blocks/${id}/revoke`, admin.token, { reason: 'curto' })).status,
    ).toBe(400);
    const r = await t.post(`/admin/blocks/${id}/revoke`, admin.token, {
      reason: 'Foi engano do cadastro',
    });
    expect(r.body.status).toBe('REVOGADO');
    expect((await t.get('/association/me', driver.token)).status).toBe(200);
    expect(
      (
        await t.post(`/admin/blocks/${id}/revoke`, admin.token, {
          reason: 'Foi engano do cadastro',
        })
      ).status,
    ).toBe(409);
    // revogado pode ser bloqueado de novo (novo registro)
    expect((await block('Reincidência comprovada')).status).toBe(201);
  });

  it('o banco não deixa mudar o motivo nem apagar o bloqueio', async () => {
    const id = (await block()).body.id;
    await expect(
      t.prisma.accountBlock.update({ where: { id }, data: { reason: 'outro motivo' } }),
    ).rejects.toThrow();
    await expect(t.prisma.accountBlock.delete({ where: { id } })).rejects.toThrow();
  });

  it('conta bloqueada não recebe oferta de entrega', async () => {
    await t.online(driver, near(100));
    await t.prisma.user.update({ where: { id: driver.id }, data: { blockedAt: new Date() } });
    const client = await t.client();
    await t.createDelivery(client).catch(() => undefined);
    expect(await t.prisma.deliveryOffer.count()).toBe(0);
  });

  it('a trilha registra escritas e leituras sensíveis, e só admin lê', async () => {
    const d = await t.driver('Pendente', { approved: false });
    const doc = await t.prisma.document.findFirstOrThrow({ where: { userId: d.id, type: 'CNH' } });
    await t.get('/admin/drivers', admin.token); // leitura comum: fora da trilha
    await t.get(`/admin/documents/${doc.id}/file`, admin.token).catch(() => undefined); // arquivo de teste não existe
    await t.post(`/admin/documents/${doc.id}/review`, admin.token, { status: 'APROVADO' });
    await block();

    const log = (await t.get('/admin/audit', admin.token)).body;
    const actions = log.items.map((i: any) => i.action);
    expect(actions).toContain('POST /admin/users/:id/block');
    expect(actions).toContain('POST /admin/documents/:id/review');
    expect(actions).not.toContain('GET /admin/drivers');
    const blockEntry = log.items.find((i: any) => i.action === 'POST /admin/users/:id/block');
    expect(blockEntry).toMatchObject({
      actorId: admin.id,
      actorName: 'Admin',
      params: { id: driver.id },
      reason: 'Documento do veículo falsificado',
    });

    expect((await t.get('/admin/audit', driver.token)).status).toBe(403);
    // ação que falhou não entra
    const before = await t.prisma.auditLog.count();
    await t.post(`/admin/users/${driver.id}/block`, admin.token, { reason: 'x' });
    expect(await t.prisma.auditLog.count()).toBe(before);
  });

  it('a trilha filtra por ação e pagina', async () => {
    await block();
    for (let i = 0; i < 3; i++)
      await t.post('/admin/budget/entries', admin.token, {
        kind: 'DESPESA',
        category: 'JURIDICO',
        description: `Despesa número ${i}`,
        amountCents: 100,
        occurredOn: '2026-10-01',
      });
    const page1 = (await t.get('/admin/audit?limit=2', admin.token)).body;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await t.get(`/admin/audit?limit=2&before=${page1.nextCursor}`, admin.token))
      .body;
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const only = (
      await t.get(
        `/admin/audit?action=${encodeURIComponent('POST /admin/budget/entries')}`,
        admin.token,
      )
    ).body;
    expect(only.items).toHaveLength(3);
  });

  it('a trilha é somente inserção', async () => {
    await block();
    const row = await t.prisma.auditLog.findFirstOrThrow();
    await expect(
      t.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'x' } }),
    ).rejects.toThrow();
    await expect(t.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe('orçamento aberto', () => {
  let t: TestApp;
  let admin: TestUser;
  const year = new Date().getUTCFullYear();
  const entry = (extra: object = {}) => ({
    kind: 'DESPESA',
    category: 'INFRAESTRUTURA',
    description: 'Servidor do mês',
    amountCents: 12_000,
    occurredOn: `${year}-01-10`,
    ...extra,
  });

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
  });

  it('valida o lançamento', async () => {
    for (const bad of [
      { amountCents: 0 },
      { amountCents: -5 },
      { category: 'DOACAO' },
      { description: 'ab' },
      { occurredOn: '2026-02-31' },
      { occurredOn: '2999-01-01' },
      { kind: 'OUTRO' },
    ])
      expect(
        (await t.post('/admin/budget/entries', admin.token, entry(bad))).status,
        JSON.stringify(bad),
      ).toBe(400);
  });

  it('soma receitas (taxa do ledger + lançadas) e despesas; estorno sai das contas', async () => {
    // taxa base de uma corrida de R$ 11,00 = R$ 1,10, vinda do ledger
    const c = await t.client();
    const d = await t.driver('Maria');
    await t.online(d, near(100));
    await t.runToDelivered(c, d);
    const e1 = (await t.post('/admin/budget/entries', admin.token, entry())).body;
    await t.post(
      '/admin/budget/entries',
      admin.token,
      entry({
        kind: 'RECEITA',
        category: 'DOACAO',
        description: 'Doação de apoiador',
        amountCents: 30_000,
      }),
    );
    const wrong = (
      await t.post(
        '/admin/budget/entries',
        admin.token,
        entry({ amountCents: 99_999, description: 'Lançado errado' }),
      )
    ).body;

    let b = (await t.get(`/panel/budget?year=${year}`, admin.token)).body;
    expect(b.summary).toMatchObject({ revenueCents: 30_000 + 110, expenseCents: 12_000 + 99_999 });

    const rev = await t.post(`/admin/budget/entries/${wrong.id}/reverse`, admin.token, {
      reason: 'Valor digitado errado',
    });
    expect(rev.status).toBe(200);
    expect(
      (
        await t.post(`/admin/budget/entries/${wrong.id}/reverse`, admin.token, {
          reason: 'Valor digitado errado',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await t.post(`/admin/budget/entries/${rev.body.id}/reverse`, admin.token, {
          reason: 'Estornar estorno',
        })
      ).status,
    ).toBe(409);
    expect(
      (await t.post(`/admin/budget/entries/${e1.id}/reverse`, admin.token, { reason: 'x' })).status,
    ).toBe(400);

    b = (await t.get(`/panel/budget?year=${year}`, admin.token)).body;
    expect(b.summary).toMatchObject({
      revenueCents: 30_110,
      expenseCents: 12_000,
      balanceCents: 18_110,
    });
    expect(b.entries.find((e: any) => e.id === wrong.id).reversed).toBe(true);
    expect(b.entries.find((e: any) => e.id === rev.body.id).isReversal).toBe(true);
    expect(b.summary.byCategory.map((x: any) => x.category)).toContain('TAXA_BASE');
  });

  it('lançamentos não se editam nem se apagam no banco', async () => {
    const e = (await t.post('/admin/budget/entries', admin.token, entry())).body;
    await expect(
      t.prisma.budgetEntry.update({ where: { id: e.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow();
    await expect(t.prisma.budgetEntry.delete({ where: { id: e.id } })).rejects.toThrow();
  });
});

describe('painel: motoristas, comerciantes, métricas', () => {
  let t: TestApp;
  let admin: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
  });

  it('lista motoristas com pendentes primeiro e filtra por situação', async () => {
    await t.driver('Aprovada');
    await t.driver('Pendente', { approved: false });
    const all = (await t.get('/admin/drivers', admin.token)).body;
    expect(all.map((d: any) => d.approval.status)).toEqual(['PENDENTE', 'APROVADO']);
    expect(all[0].documents).toHaveLength(3);
    const pend = (await t.get('/admin/drivers?status=PENDENTE', admin.token)).body;
    expect(pend).toHaveLength(1);
    expect(pend[0].name).toBe('Pendente Silva');
    expect((await t.get('/admin/drivers?status=XX', admin.token)).status).toBe(400);
    expect((await t.get('/admin/drivers?q=aprov', admin.token)).body).toHaveLength(1);
  });

  it('aprovar os documentos pelo painel aprova o motorista', async () => {
    await t.driver('Pendente', { approved: false });
    const row = (await t.get('/admin/drivers?status=PENDENTE', admin.token)).body[0];
    for (const d of row.documents)
      expect(
        (await t.post(`/admin/documents/${d.id}/review`, admin.token, { status: 'APROVADO' }))
          .status,
      ).toBe(200);
    expect((await t.get('/admin/drivers', admin.token)).body[0].approval.status).toBe('APROVADO');
  });

  it('comerciante: lista, aprova e recusa com motivo', async () => {
    const m = await t.user(['COMERCIANTE'], 'Dona Rosa');
    await t.prisma.merchant.create({
      data: {
        userId: m.id,
        tradeName: 'Padaria da Rosa',
        address: 'Rua A, 1',
        lat: -7.1,
        lng: -34.8,
      },
    });
    const list = (await t.get('/admin/merchants?status=PENDENTE', admin.token)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tradeName: 'Padaria da Rosa', status: 'PENDENTE' });
    expect(
      (await t.post(`/admin/merchants/${m.id}/review`, admin.token, { status: 'REPROVADO' }))
        .status,
    ).toBe(400);
    expect(
      (
        await t.post(`/admin/merchants/${m.id}/review`, admin.token, {
          status: 'REPROVADO',
          reason: 'CNPJ não confere',
        })
      ).status,
    ).toBe(200);
    expect(
      (await t.get('/admin/merchants?status=REPROVADO', admin.token)).body[0].rejectionReason,
    ).toBe('CNPJ não confere');
    expect(
      (await t.post(`/admin/merchants/${m.id}/review`, admin.token, { status: 'APROVADO' })).status,
    ).toBe(200);
    expect((await t.get('/admin/merchants?status=APROVADO', admin.token)).body).toHaveLength(1);
    const c = await t.client();
    expect(
      (await t.post(`/admin/merchants/${m.id}/review`, c.token, { status: 'APROVADO' })).status,
    ).toBe(403);
  });

  it('busca de usuários por nome/telefone e filtro de bloqueados', async () => {
    const d = await t.driver('Joana');
    await t.client('Pedro');
    expect((await t.get('/admin/users?q=joan', admin.token)).body.map((u: any) => u.name)).toEqual([
      'Joana',
    ]);
    expect(
      (await t.get(`/admin/users?q=${encodeURIComponent(d.phone)}`, admin.token)).body,
    ).toHaveLength(1);
    await t.post(`/admin/users/${d.id}/block`, admin.token, {
      reason: 'Motivo suficientemente longo',
    });
    expect(
      (await t.get('/admin/users?blocked=true', admin.token)).body.map((u: any) => u.name),
    ).toEqual(['Joana']);
  });

  it('painel inicial: pedidos, corridas, ganhos, cotas, satisfação e filas', async () => {
    const c = await t.client();
    const d = await t.driver('Maria', { associationRate: 4 });
    await t.giveQuotas(d.id, 31);
    await t.online(d, near(100));
    const id = await t.runToDelivered(c, d);
    await t.post(`/deliveries/${id}/rating`, c.token, { stars: 5 });
    await t.createDelivery(c); // segundo pedido, em andamento/oferecido
    await t.driver('Pendente', { approved: false });

    const o = (await t.get('/admin/overview?days=30', admin.token)).body;
    expect(o.orders).toMatchObject({
      total: 2,
      concluded: 1,
      cancelled: 0,
      inProgress: 1,
      completionRate: 1,
    });
    expect(o.rides.total).toBe(0);
    expect(o.earnings).toMatchObject({
      workers: 1,
      trips: 1,
      grossCents: 1100,
      netCents: 1100 - 110 - 44,
    });
    expect(o.earnings.avgNetPerWorkerCents).toBe(946);
    expect(o.association).toMatchObject({
      members: 1,
      levels: { SILVER: 1 },
      platformRevenueCents: 110,
    });
    expect(o.association.totalQuotas).toBeGreaterThanOrEqual(31);
    expect(o.satisfaction.clientRatesDriver).toMatchObject({ count: 1, average: 5 });
    expect(o.queues.documents).toBe(3);
    expect((await t.get('/admin/overview?days=0', admin.token)).status).toBe(400);
    expect((await t.get('/admin/overview', driverToken(d))).status).toBe(403);
  });
});

const driverToken = (d: TestUser) => d.token;
