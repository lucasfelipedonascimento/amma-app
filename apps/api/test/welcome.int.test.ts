import { HOUSE_CHECKLIST } from '@amma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PICKUP, TestApp, near, type TestUser } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.4 teste');
const ALWAYS = { always: true, slots: [] };
const CHECKLIST = Object.fromEntries(HOUSE_CHECKLIST.map((i) => [i.key, true]));

/** Horário que NÃO inclui o instante atual (em João Pessoa): de 2 h à frente até 3 h à frente. */
const closedNow = () => {
  const h = (new Date(Date.now() - 3 * 3_600_000).getUTCHours() + 2) % 24;
  const hh = (n: number) => `${String(n % 24).padStart(2, '0')}:00`;
  return { always: false, slots: [{ days: [0, 1, 2, 3, 4, 5, 6], open: hh(h), close: hh(h + 1) }] };
};

describe('pontos de acolhida', () => {
  let t: TestApp;
  let admin: TestUser;
  let host: TestUser;
  let ana: TestUser;
  let bruno: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
    host = await t.client('Dona Maria');
    ana = await t.driver('Ana');
    bruno = await t.driver('Bruno');
  });

  const body = (extra: object = {}) => ({
    type: 'COMERCIO',
    name: 'Padaria Boa Hora',
    address: 'Rua das Flores, 100',
    neighborhood: 'Manaíra',
    lat: PICKUP.lat,
    lng: PICKUP.lng,
    hours: ALWAYS,
    amenities: ['AGUA', 'BANHEIRO'],
    capacity: 4,
    ...extra,
  });
  const house = (extra: object = {}) =>
    body({ type: 'CASA_PARCEIRA', name: 'Casa da Dona Maria', checklist: CHECKLIST, ...extra });
  const create = async (u: TestUser, b: object = body()) => {
    const r = await t.post('/welcome-points', u.token, b);
    if (r.status !== 201) throw new Error(`cadastro falhou: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const approve = (
    id: string,
    u = admin,
    b: object = { identityChecked: true, placeChecked: true },
  ) => t.post(`/admin/welcome-points/${id}/approve`, u.token, b);
  const activeHouse = async (extra: object = {}, owner = host) => {
    const p = await create(owner, house(extra));
    expect((await approve(p.id)).status).toBe(200);
    return p;
  };
  const checkIn = (u: TestUser, id: string, at = near(0)) =>
    t.post(`/welcome-points/${id}/check-in`, u.token, at);
  /** Check-in já com tempo de estadia (recua o início). */
  const visit = async (u: TestUser, id: string, minutes = 30) => {
    const r = await checkIn(u, id);
    expect(r.status).toBe(201);
    await t.prisma.checkIn.update({
      where: { id: r.body.checkIn.id },
      data: { startedAt: new Date(Date.now() - minutes * 60_000) },
    });
    return r.body.checkIn.id as string;
  };
  const end = (u: TestUser, checkInId: string) =>
    t.post(`/welcome-points/check-ins/${checkInId}/end`, u.token);
  /** Visita completa: entra, fica um tempo e sai. */
  const done = async (u: TestUser, id: string, minutes = 30) => {
    const c = await visit(u, id, minutes);
    expect((await end(u, c)).status).toBe(200);
    return c;
  };
  const rate = (u: TestUser, checkInId: string, stars: number, comment?: string) =>
    t.post(`/welcome-points/check-ins/${checkInId}/rate`, u.token, { stars, comment });
  const status = async (id: string) =>
    (await t.prisma.welcomePoint.findUniqueOrThrow({ where: { id } })).status;
  const mapQuery = (q = '') => `/welcome-points?lat=${PICKUP.lat}&lng=${PICKUP.lng}${q}`;

  describe('cadastro', () => {
    it('espaço público e comércio entram no mapa na hora; casa parceira espera a análise', async () => {
      const pub = await create(host, body({ type: 'ESPACO_PUBLICO', name: 'Praça do Ponto' }));
      const shop = await create(host, body({ lng: PICKUP.lng + 0.01 }));
      const home = await create(host, house({ lng: PICKUP.lng + 0.02 }));
      expect(pub.status).toBe('ATIVO');
      expect(shop.status).toBe('ATIVO');
      expect(home.status).toBe('EM_ANALISE');
      const map = (await t.get(mapQuery('&radiusMeters=5000'), ana.token)).body;
      expect(map.map((p: { id: string }) => p.id).sort()).toEqual([pub.id, shop.id].sort());
    });

    it('casa parceira exige o checklist de segurança completo', async () => {
      const r = await t.post(
        '/welcome-points',
        host.token,
        house({ checklist: { ...CHECKLIST, SEM_COBRANCA: false } }),
      );
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/SEM_COBRANCA/);
      expect(
        (await t.post('/welcome-points', host.token, house({ checklist: undefined }))).status,
      ).toBe(400);
      expect(
        (await t.post('/welcome-points', host.token, body({ checklist: CHECKLIST }))).status,
      ).toBe(400);
    });

    it('recusa horário, capacidade, tipo e campos inválidos', async () => {
      const bad = async (extra: object) =>
        (await t.post('/welcome-points', host.token, body(extra))).status;
      expect(await bad({ hours: { always: false, slots: [] } })).toBe(400);
      expect(
        await bad({
          hours: { always: false, slots: [{ days: [9], open: '08:00', close: '12:00' }] },
        }),
      ).toBe(400);
      expect(await bad({ capacity: 0 })).toBe(400);
      expect(await bad({ capacity: 51 })).toBe(400);
      expect(await bad({ type: 'PRACA' })).toBe(400);
      expect(await bad({ amenities: ['PISCINA'] })).toBe(400);
      expect(await bad({ lat: 120 })).toBe(400);
      expect(await bad({ status: 'ATIVO' })).toBe(400); // não aceita escolher o próprio status
      expect((await t.post('/welcome-points', undefined, body())).status).toBe(401);
    });

    it('não duplica o mesmo tipo de ponto no mesmo lugar e limita cadastros por dia', async () => {
      await create(host, body());
      expect((await t.post('/welcome-points', ana.token, body())).status).toBe(409);
      await create(host, body({ lng: PICKUP.lng + 0.01, name: 'B' + 'a'.repeat(3) }));
      await create(host, body({ lng: PICKUP.lng + 0.02, name: 'Outro lugar' }));
      expect(
        (await t.post('/welcome-points', host.token, body({ lng: PICKUP.lng + 0.03 }))).status,
      ).toBe(409);
    });

    it('o dono edita só o que pode e remove o próprio ponto', async () => {
      const p = await create(host, body());
      const e = await t.req('PATCH', `/welcome-points/${p.id}`, host.token, {
        capacity: 9,
        name: 'Novo nome',
      });
      expect(e.body.capacity).toBe(9);
      expect(e.body.name).toBe('Novo nome');
      expect(
        (await t.req('PATCH', `/welcome-points/${p.id}`, host.token, { address: 'Outra rua' }))
          .status,
      ).toBe(400);
      expect(
        (await t.req('PATCH', `/welcome-points/${p.id}`, ana.token, { capacity: 2 })).status,
      ).toBe(404);
      expect((await t.request('DELETE', `/welcome-points/${p.id}`, ana.token)).status).toBe(404);
      expect((await t.request('DELETE', `/welcome-points/${p.id}`, host.token)).status).toBe(204);
      expect(await status(p.id)).toBe('REMOVIDO');
      expect((await t.get(`/welcome-points/${p.id}`, ana.token)).status).toBe(404);
    });
  });

  describe('mapa e filtros', () => {
    it('filtra por tipo, comodidade, distância, aberto agora e nota; ordena do mais perto', async () => {
      const far = await create(
        host,
        body({ name: 'Longe', lat: PICKUP.lat + 0.02, amenities: ['CARREGADOR'] }),
      );
      const other = await t.client('Outro dono');
      const mid = await create(
        other,
        body({ name: 'Médio', lat: PICKUP.lat + 0.005, amenities: ['AGUA', 'CARREGADOR'] }),
      );
      const closeOne = await create(
        host,
        body({ name: 'Perto', type: 'ESPACO_PUBLICO', lat: PICKUP.lat + 0.001 }),
      );
      const closed = await create(
        other,
        body({ name: 'Fechado', lat: PICKUP.lat + 0.002, hours: closedNow() }),
      );
      const list = async (q = '') =>
        (await t.get(mapQuery(q), ana.token)).body.map((p: { name: string }) => p.name);

      expect(await list('&radiusMeters=10000')).toEqual(['Perto', 'Fechado', 'Médio', 'Longe']);
      expect(await list('&radiusMeters=300')).toEqual(['Perto', 'Fechado']);
      expect(await list('&radiusMeters=10000&types=ESPACO_PUBLICO')).toEqual(['Perto']);
      expect(await list('&radiusMeters=10000&types=ESPACO_PUBLICO,COMERCIO')).toHaveLength(4);
      expect(await list('&radiusMeters=10000&amenities=CARREGADOR')).toEqual(['Médio', 'Longe']);
      expect(await list('&radiusMeters=10000&amenities=CARREGADOR,AGUA')).toEqual(['Médio']);
      expect(await list('&radiusMeters=10000&openNow=true')).toEqual(['Perto', 'Médio', 'Longe']);
      expect(closed.status).toBe('ATIVO');
      expect(far.status).toBe('ATIVO');
      expect(mid.status).toBe('ATIVO');
      expect(closeOne.status).toBe('ATIVO');
    });

    it('mostra distância, "aberto agora" e rejeita filtro inválido', async () => {
      await create(host, body({ lat: PICKUP.lat + 0.001 }));
      const [p] = (await t.get(mapQuery(), ana.token)).body;
      expect(p.distanceMeters).toBeGreaterThan(90);
      expect(p.distanceMeters).toBeLessThan(130);
      expect(p.openNow).toBe(true);
      expect((await t.get(mapQuery('&types=PRACA'), ana.token)).status).toBe(400);
      expect((await t.get(mapQuery('&amenities=PISCINA'), ana.token)).status).toBe(400);
      expect((await t.get('/welcome-points', ana.token)).status).toBe(400); // sem posição
      expect((await t.get(mapQuery('&radiusMeters=999999'), ana.token)).status).toBe(400);
    });

    it('filtra por nota mínima (sem média ainda passa, com média baixa não)', async () => {
      const good = await create(host, body({ name: 'Bom' }));
      await create(host, body({ name: 'Novo', lng: PICKUP.lng + 0.001 }));
      const third = await create(ana, body({ name: 'Médio', type: 'ESPACO_PUBLICO' }));
      for (const [id, stars] of [
        [good.id, 5],
        [third.id, 3],
      ] as const)
        for (let i = 0; i < 3; i++) {
          const d = await t.driver(`V${i}${stars}`);
          expect((await rate(d, await done(d, id), stars)).status).toBe(201);
        }
      const names = async (q: string) =>
        (await t.get(mapQuery(q), bruno.token)).body.map((p: { name: string }) => p.name);
      expect(await names('&minRating=4')).toEqual(['Bom', 'Novo']);
      expect(await names('&minRating=1')).toHaveLength(3);
    });

    it('a casa parceira aparece só aproximada e sem endereço; o dono e quem está lá veem tudo', async () => {
      const p = await activeHouse({ lat: -7.11537, lng: -34.86149, reference: 'Portão azul' });
      const seen = (await t.get(`/welcome-points/${p.id}`, ana.token)).body;
      expect(seen.approximate).toBe(true);
      expect(seen.address).toBeNull();
      expect(seen.reference).toBeNull();
      expect(seen.lat).toBe(-7.115);
      expect(seen.lng).toBe(-34.861);
      expect(seen.checklist).toBeUndefined();
      expect(seen.benefitKind).toBeUndefined();
      expect(seen.status).toBeUndefined();
      const inList = (await t.get(mapQuery(), ana.token)).body[0];
      expect(inList.address).toBeNull();

      const own = (await t.get(`/welcome-points/${p.id}`, host.token)).body;
      expect(own.address).toBe('Rua das Flores, 100');
      expect(own.lat).toBe(-7.11537);
      expect(own.checklist).toBeTruthy();
      expect(own.status).toBe('ATIVO');

      const ci = await checkIn(ana, p.id, { lat: -7.11537, lng: -34.86149 });
      expect(ci.status).toBe(201);
      expect(ci.body.point.address).toBe('Rua das Flores, 100');
      expect(ci.body.point.reference).toBe('Portão azul');
      expect(ci.body.point.approximate).toBe(false);
      // Outro motorista continua sem ver.
      expect((await t.get(`/welcome-points/${p.id}`, bruno.token)).body.address).toBeNull();
    });

    it('comércio mostra o endereço; ponto em análise só o dono e o admin enxergam', async () => {
      const shop = await create(host, body());
      expect((await t.get(`/welcome-points/${shop.id}`, ana.token)).body.address).toBe(
        'Rua das Flores, 100',
      );
      const home = await create(host, house({ lng: PICKUP.lng + 0.01 }));
      expect((await t.get(`/welcome-points/${home.id}`, ana.token)).status).toBe(404);
      expect((await t.get(`/welcome-points/${home.id}`, host.token)).status).toBe(200);
      expect((await t.get(`/welcome-points/${home.id}`, admin.token)).status).toBe(200);
      const mine = (await t.get('/welcome-points/mine', host.token)).body;
      expect(mine.map((p: { id: string }) => p.id).sort()).toEqual([home.id, shop.id].sort());
    });
  });

  describe('casa parceira: aprovação pelo admin', () => {
    it('só o admin decide, e só depois de conferir a identidade e o local', async () => {
      const p = await create(host, house());
      expect((await approve(p.id, ana)).status).toBe(403);
      expect(
        (await approve(p.id, admin, { identityChecked: true, placeChecked: false })).status,
      ).toBe(400);
      expect((await approve(p.id, admin, { identityChecked: true })).status).toBe(400);
      const ok = await approve(p.id, admin, {
        identityChecked: true,
        placeChecked: true,
        note: 'Visita feita',
      });
      expect(ok.body.status).toBe('ATIVO');
      expect((await t.get(mapQuery(), ana.token)).body).toHaveLength(1);
      expect((await approve(p.id)).status).toBe(409); // já ativa
    });

    it('recusar exige motivo e tira a casa de circulação', async () => {
      const p = await create(host, house());
      expect((await t.post(`/admin/welcome-points/${p.id}/refuse`, admin.token, {})).status).toBe(
        400,
      );
      const r = await t.post(`/admin/welcome-points/${p.id}/refuse`, admin.token, {
        note: 'Não encontramos o endereço',
      });
      expect(r.body.status).toBe('RECUSADO');
      expect((await approve(p.id)).status).toBe(409);
      const mine = (await t.get('/welcome-points/mine', host.token)).body[0];
      expect(mine.status).toBe('RECUSADO');
      expect(mine.statusNote).toBe('Não encontramos o endereço');
    });

    it('o admin não decide o próprio ponto', async () => {
      const p = await create(admin, house());
      expect((await approve(p.id)).status).toBe(403);
      expect(
        (await t.post(`/admin/welcome-points/${p.id}/refuse`, admin.token, { note: 'Teste teste' }))
          .status,
      ).toBe(403);
    });

    it('guarda a linha do tempo e o admin vê o checklist', async () => {
      const p = await create(host, house());
      await approve(p.id);
      const d = (await t.get(`/admin/welcome-points/${p.id}`, admin.token)).body;
      expect(d.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
        'EM_ANALISE',
        'ATIVO',
      ]);
      expect(d.checklist.SEM_COBRANCA).toBe(true);
      expect(d.owner.phone).toBeTruthy();
      const q = (await t.get('/admin/welcome-points?status=EM_ANALISE', admin.token)).body;
      expect(q).toHaveLength(0);
      expect((await t.get('/admin/welcome-points', host.token)).status).toBe(403);
      // A linha do tempo é só de inserção.
      await expect(t.prisma.pointEvent.deleteMany({ where: { pointId: p.id } })).rejects.toThrow();
    });
  });

  describe('check-in', () => {
    it('só perto do ponto, só aberto, só motorista, e o anfitrião não entra no próprio', async () => {
      const p = await create(host, body());
      const far = await checkIn(ana, p.id, near(500));
      expect(far.status).toBe(409);
      expect(far.body.message).toMatch(/200 m/);
      expect((await checkIn(ana, p.id, near(150))).status).toBe(201);
      const closed = await create(host, body({ lng: PICKUP.lng + 0.01, hours: closedNow() }));
      expect(
        (await checkIn(bruno, closed.id, { lat: PICKUP.lat, lng: PICKUP.lng + 0.01 })).status,
      ).toBe(409);
      const passenger = await t.client('Passageira');
      expect((await checkIn(passenger, p.id)).status).toBe(403);
      expect((await checkIn(host, p.id)).status).toBe(403);
      expect(
        (await t.post(`/welcome-points/${p.id}/check-in`, bruno.token, { lat: 'x', lng: 1 }))
          .status,
      ).toBe(400);
    });

    it('um check-in aberto por vez e intervalo entre visitas ao mesmo ponto', async () => {
      const a = await create(host, body());
      const b = await create(host, body({ lng: PICKUP.lng + 0.001, name: 'Segundo ponto' }));
      const first = await checkIn(ana, a.id);
      expect(first.status).toBe(201);
      expect((await checkIn(ana, b.id, { lat: PICKUP.lat, lng: PICKUP.lng + 0.001 })).status).toBe(
        409,
      );
      expect((await end(ana, first.body.checkIn.id)).status).toBe(200);
      expect((await checkIn(ana, a.id)).status).toBe(409); // acabou de sair
      expect((await checkIn(ana, b.id, { lat: PICKUP.lat, lng: PICKUP.lng + 0.001 })).status).toBe(
        201,
      );
    });

    it('respeita a capacidade, mesmo com todos chegando juntos', async () => {
      const p = await create(host, body({ capacity: 2 }));
      const drivers = [
        await t.driver('D1'),
        await t.driver('D2'),
        await t.driver('D3'),
        await t.driver('D4'),
      ];
      const results = await Promise.all(drivers.map((d) => checkIn(d, p.id)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const seen = (await t.get(`/welcome-points/${p.id}`, ana.token)).body;
      expect(seen.occupied).toBe(2);
      expect(seen.capacity).toBe(2);
    });

    it('sair antes do mínimo não conta nem rende; encerrar duas vezes é recusado', async () => {
      const p = await activeHouse();
      const c = await checkIn(ana, p.id);
      const out = await end(ana, c.body.checkIn.id);
      expect(out.body.completed).toBe(false);
      expect(out.body.canRate).toBe(false);
      expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'HOST_BENEFIT' } })).toBe(0);
      expect((await end(ana, c.body.checkIn.id)).status).toBe(409);
      expect((await end(bruno, c.body.checkIn.id)).status).toBe(404);
      expect((await rate(ana, c.body.checkIn.id, 5)).status).toBe(409);
    });

    it('o check-in ativo aparece para o motorista e fecha sozinho depois do tempo máximo, sem benefício', async () => {
      const p = await activeHouse();
      expect((await t.get('/welcome-points/check-ins/active', ana.token)).body.checkIn).toBeNull();
      const c = await checkIn(ana, p.id);
      const active = (await t.get('/welcome-points/check-ins/active', ana.token)).body;
      expect(active.checkIn.id).toBe(c.body.checkIn.id);
      expect(active.point.address).toBe('Rua das Flores, 100');
      await t.prisma.checkIn.update({
        where: { id: c.body.checkIn.id },
        data: { startedAt: new Date(Date.now() - 5 * 3_600_000) },
      });
      expect((await t.get('/welcome-points/check-ins/active', ana.token)).body.checkIn).toBeNull();
      const row = await t.prisma.checkIn.findUniqueOrThrow({ where: { id: c.body.checkIn.id } });
      expect(row.completed).toBe(false);
      expect(row.benefitCents).toBe(0);
      expect(row.endedAt!.getTime()).toBeLessThan(Date.now() - 3_600_000);
      expect((await t.get(`/welcome-points/${p.id}`, bruno.token)).body.occupied).toBe(0);
    });
  });

  describe('benefício do anfitrião', () => {
    const balance = async (account: string) => {
      const rows = await t.prisma.ledgerPosting.findMany({ where: { account } });
      return rows.reduce(
        (s, r) => s + (r.direction === 'CREDIT' ? r.amountCents : -r.amountCents),
        0,
      );
    };

    it('crédito: cada visita que conta vira lançamento no saldo do anfitrião', async () => {
      const p = await activeHouse({ benefitKind: 'CREDITO' });
      const id = await visit(ana, p.id);
      const out = await end(ana, id);
      expect(out.body.completed).toBe(true);
      const row = await t.prisma.checkIn.findUniqueOrThrow({ where: { id } });
      expect(row.benefitCents).toBe(100);
      expect(await balance(`WORKER_BALANCE:${host.id}`)).toBe(100);
      expect(await balance('ASSOCIATION_HOST_BENEFITS')).toBe(-100);
      expect(await balance(`HOST_DISCOUNT:${host.id}`)).toBe(0);
      const tx = await t.prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: 'HOST_BENEFIT' },
      });
      expect(tx.reference).toBe(id);
    });

    it('desconto: vai para a conta de desconto, não para o saldo', async () => {
      const p = await activeHouse({ benefitKind: 'DESCONTO' });
      await end(ana, await visit(ana, p.id));
      expect(await balance(`HOST_DISCOUNT:${host.id}`)).toBe(100);
      expect(await balance(`WORKER_BALANCE:${host.id}`)).toBe(0);
    });

    it('o anfitrião escolhe o tipo de benefício depois', async () => {
      const p = await activeHouse();
      expect((await t.get(`/welcome-points/${p.id}`, host.token)).body.benefitKind).toBe('CREDITO');
      const e = await t.req('PATCH', `/welcome-points/${p.id}`, host.token, {
        benefitKind: 'DESCONTO',
      });
      expect(e.body.benefitKind).toBe('DESCONTO');
    });

    it('comércio e espaço público não rendem benefício', async () => {
      const shop = await create(host, body());
      const pub = await create(host, body({ type: 'ESPACO_PUBLICO', lng: PICKUP.lng + 0.001 }));
      await end(ana, await visit(ana, shop.id));
      const c = await checkIn(bruno, pub.id, { lat: PICKUP.lat, lng: PICKUP.lng + 0.001 });
      await t.prisma.checkIn.update({
        where: { id: c.body.checkIn.id },
        data: { startedAt: new Date(Date.now() - 600_000) },
      });
      expect((await end(bruno, c.body.checkIn.id)).body.completed).toBe(true);
      expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'HOST_BENEFIT' } })).toBe(0);
    });

    it('para no teto mensal do ponto e completa só o que cabe', async () => {
      const p = await activeHouse();
      // 29 visitas antigas já pagaram R$ 29,00 neste mês.
      const older = await t.driver('Antigo');
      await t.prisma.checkIn.create({
        data: {
          pointId: p.id,
          userId: older.id,
          startedAt: new Date(Date.now() - 7_200_000),
          endedAt: new Date(Date.now() - 3_600_000),
          completed: true,
          distanceMeters: 5,
          benefitCents: 2950,
        },
      });
      const d1 = await visit(ana, p.id);
      await end(ana, d1);
      expect((await t.prisma.checkIn.findUniqueOrThrow({ where: { id: d1 } })).benefitCents).toBe(
        50,
      );
      const d2 = await visit(bruno, p.id);
      await end(bruno, d2);
      expect((await t.prisma.checkIn.findUniqueOrThrow({ where: { id: d2 } })).benefitCents).toBe(
        0,
      );
      expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'HOST_BENEFIT' } })).toBe(1);
    });

    it('o ledger de benefício é somente inserção', async () => {
      const p = await activeHouse();
      await end(ana, await visit(ana, p.id));
      await expect(
        t.prisma.ledgerPosting.deleteMany({ where: { account: 'ASSOCIATION_HOST_BENEFITS' } }),
      ).rejects.toThrow();
    });
  });

  describe('avaliação dos dois lados', () => {
    it('o motorista avalia o ponto uma vez por visita, só se a visita contou', async () => {
      const p = await create(host, body());
      const id = await visit(ana, p.id);
      expect((await rate(ana, id, 4)).status).toBe(409); // ainda em andamento
      await end(ana, id);
      expect((await rate(ana, id, 0)).status).toBe(400);
      expect((await rate(ana, id, 6)).status).toBe(400);
      expect((await rate(bruno, id, 4)).status).toBe(404);
      expect((await rate(ana, id, 4, 'Água gelada')).status).toBe(201);
      expect((await rate(ana, id, 5)).status).toBe(409);
    });

    it('a média só aparece com 3 notas e arredonda para baixo; ninguém vê comentário', async () => {
      const p = await create(host, body());
      for (const stars of [5, 4]) {
        const d = await t.driver(`D${stars}`);
        await rate(d, await done(d, p.id), stars, 'Segredo do comentário');
      }
      let seen = (await t.get(`/welcome-points/${p.id}`, bruno.token)).body;
      expect(seen.rating).toEqual({ average: null, count: 2 });
      const d3 = await t.driver('D3');
      await rate(d3, await done(d3, p.id), 4);
      seen = (await t.get(`/welcome-points/${p.id}`, bruno.token)).body;
      expect(seen.rating).toEqual({ average: 4.3, count: 3 });
      expect(JSON.stringify(seen)).not.toContain('Segredo');
      expect(
        JSON.stringify((await t.get(`/welcome-points/${p.id}`, host.token)).body),
      ).not.toContain('Segredo');
      expect(
        JSON.stringify((await t.get(`/admin/welcome-points/${p.id}`, admin.token)).body),
      ).toContain('Segredo');
    });

    it('o anfitrião avalia o visitante; o espaço público não tem anfitrião', async () => {
      const p = await activeHouse();
      const id = await visit(ana, p.id);
      const url = `/welcome-points/check-ins/${id}/rate-visitor`;
      expect((await t.post(url, host.token, { stars: 5 })).status).toBe(409); // ainda lá
      await end(ana, id);
      expect((await t.post(url, ana.token, { stars: 5 })).status).toBe(404); // o visitante não avalia a si mesmo
      expect((await t.post(url, bruno.token, { stars: 5 })).status).toBe(404);
      expect((await t.post(url, host.token, { stars: 5, comment: 'Educada' })).status).toBe(201);
      expect((await t.post(url, host.token, { stars: 4 })).status).toBe(409);

      const pub = await create(host, body({ type: 'ESPACO_PUBLICO', lng: PICKUP.lng + 0.001 }));
      const c = await checkIn(bruno, pub.id, { lat: PICKUP.lat, lng: PICKUP.lng + 0.001 });
      await t.prisma.checkIn.update({
        where: { id: c.body.checkIn.id },
        data: { startedAt: new Date(Date.now() - 600_000) },
      });
      await end(bruno, c.body.checkIn.id);
      expect(
        (
          await t.post(`/welcome-points/check-ins/${c.body.checkIn.id}/rate-visitor`, host.token, {
            stars: 5,
          })
        ).status,
      ).toBe(403);
    });

    it('o anfitrião vê as visitas recentes só com primeiro nome e média do visitante', async () => {
      const p = await activeHouse();
      const id = await visit(ana, p.id);
      await end(ana, id);
      const list = (await t.get(`/welcome-points/${p.id}/visits`, host.token)).body;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id,
        visitorName: 'Ana',
        rated: false,
        canRate: true,
        visitorRating: { average: null, count: 0 },
      });
      expect(JSON.stringify(list)).not.toContain('Silva');
      expect(JSON.stringify(list)).not.toContain(ana.phone);
      await t.post(`/welcome-points/check-ins/${id}/rate-visitor`, host.token, { stars: 5 });
      expect((await t.get(`/welcome-points/${p.id}/visits`, host.token)).body[0].rated).toBe(true);
      expect((await t.get(`/welcome-points/${p.id}/visits`, ana.token)).status).toBe(404);
    });

    it('o motorista vê o próprio histórico e o que ainda pode avaliar', async () => {
      const p = await create(host, body());
      const id = await visit(ana, p.id);
      await end(ana, id);
      let h = (await t.get('/welcome-points/check-ins/mine', ana.token)).body;
      expect(h[0]).toMatchObject({
        id,
        rated: false,
        canRate: true,
        point: { name: 'Padaria Boa Hora' },
      });
      await rate(ana, id, 5);
      h = (await t.get('/welcome-points/check-ins/mine', ana.token)).body;
      expect(h[0]).toMatchObject({ rated: true, canRate: false });
    });

    it('depois de 7 dias não dá mais para avaliar', async () => {
      const p = await create(host, body());
      const id = await visit(ana, p.id);
      await end(ana, id);
      await t.prisma.checkIn.update({
        where: { id },
        data: { endedAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      expect((await rate(ana, id, 5)).status).toBe(409);
    });
  });

  describe('denúncia e remoção', () => {
    const report = (u: TestUser, id: string, category = 'OUTRO', text?: string) =>
      t.post(`/welcome-points/${id}/reports`, u.token, { category, text });

    it('denúncia grave tira o ponto do mapa na hora e libera quem estava lá', async () => {
      const p = await create(host, body());
      const c = await checkIn(bruno, p.id);
      const r = await report(ana, p.id, 'SEGURANCA', 'Homem estranho na porta');
      expect(r.status).toBe(201);
      expect(r.body.text).toBeUndefined();
      expect(await status(p.id)).toBe('SUSPENSO');
      expect((await t.get(mapQuery(), bruno.token)).body).toHaveLength(0);
      expect((await t.get(`/welcome-points/${p.id}`, bruno.token)).status).toBe(404);
      expect(
        (await t.get('/welcome-points/check-ins/active', bruno.token)).body.checkIn,
      ).toBeNull();
      expect((await checkIn(ana, p.id)).status).toBe(404);
      const own = (await t.get(`/welcome-points/${p.id}`, host.token)).body;
      expect(own.status).toBe('SUSPENSO');
      expect(own.statusNote).toMatch(/grave/);
      expect(c.status).toBe(201);
    });

    it('denúncias leves suspendem só com 3 pessoas diferentes; a mesma pessoa não repete', async () => {
      const p = await create(host, body());
      const [d1, d2, d3] = [await t.driver('D1'), await t.driver('D2'), await t.driver('D3')];
      expect((await report(d1, p.id)).status).toBe(201);
      expect((await report(d1, p.id, 'COBRANCA_INDEVIDA')).status).toBe(409);
      expect((await report(d2, p.id)).status).toBe(201);
      expect(await status(p.id)).toBe('ATIVO');
      expect((await report(d3, p.id)).status).toBe(201);
      expect(await status(p.id)).toBe('SUSPENSO');
    });

    it('o dono não denuncia o próprio ponto; ponto inexistente, categoria ruim e texto longo', async () => {
      const p = await create(host, body());
      expect((await report(host, p.id)).status).toBe(403);
      expect((await report(ana, p.id, 'PIRATARIA')).status).toBe(400);
      expect((await report(ana, p.id, 'OUTRO', 'x'.repeat(1001))).status).toBe(400);
      expect((await report(ana, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      const home = await create(host, house({ lng: PICKUP.lng + 0.01 }));
      expect((await report(ana, home.id)).status).toBe(404); // em análise: ainda não existe para os outros
    });

    it('nota média baixa, com avaliações suficientes, suspende o ponto', async () => {
      const p = await create(host, body());
      for (let i = 0; i < 5; i++) {
        const d = await t.driver(`Ruim${i}`);
        await rate(d, await done(d, p.id), i === 0 ? 2 : 1);
        if (i < 4) expect(await status(p.id)).toBe('ATIVO');
      }
      expect(await status(p.id)).toBe('SUSPENSO');
      const d = (await t.get(`/admin/welcome-points/${p.id}`, admin.token)).body;
      expect(d.events.at(-1)).toMatchObject({ actorId: null, toStatus: 'SUSPENSO' });
      expect(d.statusNote).toMatch(/Nota média/);
    });

    it('quem denunciou acompanha só a situação e a resposta', async () => {
      const p = await create(host, body());
      const r = (await report(ana, p.id, 'ESTRUTURA_DIFERENTE', 'Não tem banheiro')).body;
      expect((await t.get('/welcome-points/reports/mine', ana.token)).body[0]).toMatchObject({
        status: 'ABERTA',
        response: null,
        pointName: 'Padaria Boa Hora',
      });
      await t.post(`/admin/welcome-reports/${r.id}/resolve`, admin.token, {
        outcome: 'IMPROCEDENTE',
        response: 'Banheiro existe, conferido.',
      });
      const mine = (await t.get('/welcome-points/reports/mine', ana.token)).body[0];
      expect(mine).toMatchObject({
        status: 'IMPROCEDENTE',
        response: 'Banheiro existe, conferido.',
      });
      expect(mine.text).toBeUndefined();
      expect((await t.get('/welcome-points/reports/mine', bruno.token)).body).toEqual([]);
    });

    it('fila do admin: graves primeiro; resolver exige resposta e é uma vez só', async () => {
      const p = await create(host, body());
      const leve = (await report(ana, p.id, 'OUTRO', 'Sujo')).body;
      const q = await create(host, body({ lng: PICKUP.lng + 0.01 }));
      const grave = (await report(bruno, q.id, 'ASSEDIO', 'Fui assediado')).body;
      const list = (await t.get('/admin/welcome-reports', admin.token)).body;
      expect(list.map((x: { id: string }) => x.id)).toEqual([grave.id, leve.id]);
      expect(list[0]).toMatchObject({ severe: true, text: 'Fui assediado', point: { id: q.id } });
      expect((await t.get('/admin/welcome-reports', ana.token)).status).toBe(403);
      const url = `/admin/welcome-reports/${leve.id}/resolve`;
      expect((await t.post(url, admin.token, { outcome: 'PROCEDENTE' })).status).toBe(400);
      expect(
        (await t.post(url, admin.token, { outcome: 'TALVEZ', response: 'Veremos isso' })).status,
      ).toBe(400);
      expect(
        (
          await t.post(url, admin.token, {
            outcome: 'IMPROCEDENTE',
            response: 'Não procede.',
            removePoint: true,
          })
        ).status,
      ).toBe(400);
      expect(
        (await t.post(url, admin.token, { outcome: 'IMPROCEDENTE', response: 'Não procede.' }))
          .status,
      ).toBe(200);
      expect(
        (await t.post(url, admin.token, { outcome: 'IMPROCEDENTE', response: 'Não procede.' }))
          .status,
      ).toBe(409);
      expect((await t.get('/admin/welcome-reports?status=ABERTA', admin.token)).body).toHaveLength(
        1,
      );
    });

    it('denúncia procedente pode remover o ponto junto, com motivo', async () => {
      const p = await create(host, body());
      const r = (await report(ana, p.id, 'SEGURANCA', 'Perigoso')).body;
      const res = await t.post(`/admin/welcome-reports/${r.id}/resolve`, admin.token, {
        outcome: 'PROCEDENTE',
        response: 'Ponto removido por segurança.',
        removePoint: true,
      });
      expect(res.status).toBe(200);
      expect(await status(p.id)).toBe('REMOVIDO');
      const d = (await t.get(`/admin/welcome-points/${p.id}`, admin.token)).body;
      expect(d.statusNote).toBe('Ponto removido por segurança.');
      expect(d.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
        'ATIVO',
        'SUSPENSO',
        'REMOVIDO',
      ]);
    });

    it('reativar exige as denúncias resolvidas e um motivo', async () => {
      const p = await create(host, body());
      const r = (await report(ana, p.id, 'SEGURANCA', 'Suspeito')).body;
      const reinstate = (note = 'Conferimos o local: tudo certo.') =>
        t.post(`/admin/welcome-points/${p.id}/reinstate`, admin.token, { note });
      expect((await reinstate()).status).toBe(409);
      await t.post(`/admin/welcome-reports/${r.id}/resolve`, admin.token, {
        outcome: 'IMPROCEDENTE',
        response: 'Visita feita, sem problema.',
      });
      expect((await reinstate('')).status).toBe(400);
      expect((await reinstate()).body.status).toBe('ATIVO');
      expect((await t.get(mapQuery(), ana.token)).body).toHaveLength(1);
      expect((await reinstate()).status).toBe(409); // já ativo
    });

    it('o admin remove um ponto direto, com motivo; removido não volta nem recebe check-in', async () => {
      const p = await create(host, body());
      const url = `/admin/welcome-points/${p.id}/remove`;
      expect((await t.post(url, admin.token, { note: 'x' })).status).toBe(400);
      expect((await t.post(url, ana.token, { note: 'Sem permissão aqui' })).status).toBe(403);
      expect((await t.post(url, admin.token, { note: 'Fechou as portas' })).body.status).toBe(
        'REMOVIDO',
      );
      expect((await t.post(url, admin.token, { note: 'Fechou as portas' })).status).toBe(409);
      expect(
        (
          await t.post(`/admin/welcome-points/${p.id}/reinstate`, admin.token, {
            note: 'Voltou a abrir',
          })
        ).status,
      ).toBe(409);
      expect((await checkIn(ana, p.id)).status).toBe(404);
      expect((await t.get(mapQuery(), ana.token)).body).toHaveLength(0);
    });
  });

  describe('fotos', () => {
    const upload = (path: string, token: string, data: Buffer, mime = 'image/png') => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(data)], { type: mime }), 'foto');
      return fetch(`${t.baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
    };

    it('o dono envia JPG/PNG (até 6), os outros baixam, PDF e estranhos são recusados', async () => {
      const p = await create(host, body());
      const path = `/welcome-points/${p.id}/photos`;
      const ok = await upload(path, host.token, PNG);
      expect(ok.status).toBe(201);
      const { id } = (await ok.json()) as { id: string };
      expect((await upload(path, host.token, PDF, 'application/pdf')).status).toBe(400);
      expect((await upload(path, ana.token, PNG)).status).toBe(404);
      for (let i = 0; i < 5; i++) expect((await upload(path, host.token, PNG)).status).toBe(201);
      expect((await upload(path, host.token, PNG)).status).toBe(409);
      const dl = await fetch(`${t.baseUrl}${path}/${id}`, {
        headers: { authorization: `Bearer ${ana.token}` },
      });
      expect(dl.status).toBe(200);
      expect(dl.headers.get('content-type')).toBe('image/png');
      expect((await t.get(`/welcome-points/${p.id}`, ana.token)).body.photos).toHaveLength(6);
      expect((await t.request('DELETE', `${path}/${id}`, ana.token)).status).toBe(404);
      expect((await t.request('DELETE', `${path}/${id}`, host.token)).status).toBe(204);
      expect((await t.get(`${path}/${id}`, ana.token)).status).toBe(404);
    });

    it('foto de casa em análise só o dono baixa', async () => {
      const p = await create(host, house());
      const { id } = (await (
        await upload(`/welcome-points/${p.id}/photos`, host.token, PNG)
      ).json()) as { id: string };
      expect((await t.get(`/welcome-points/${p.id}/photos/${id}`, ana.token)).status).toBe(404);
      const own = await fetch(`${t.baseUrl}/welcome-points/${p.id}/photos/${id}`, {
        headers: { authorization: `Bearer ${host.token}` },
      });
      expect(own.status).toBe(200);
    });
  });

  describe('LGPD', () => {
    it('excluir a conta do anfitrião tira o ponto do ar e apaga endereço, fotos e checklist; as notas ficam', async () => {
      const p = await activeHouse();
      const { id: photoId } = await (async () => {
        const form = new FormData();
        form.set('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'foto');
        const r = await fetch(`${t.baseUrl}/welcome-points/${p.id}/photos`, {
          method: 'POST',
          headers: { authorization: `Bearer ${host.token}` },
          body: form,
        });
        return (await r.json()) as { id: string };
      })();
      const id = await visit(ana, p.id);
      await end(ana, id);
      await rate(ana, id, 5, 'Ótimo lugar');
      expect((await t.request('DELETE', '/me', host.token)).status).toBe(204);
      const row = await t.prisma.welcomePoint.findUniqueOrThrow({ where: { id: p.id } });
      expect(row).toMatchObject({
        status: 'REMOVIDO',
        name: '(removido)',
        address: '(removido)',
        checklist: null,
        reference: null,
      });
      expect(await t.prisma.welcomePointPhoto.count({ where: { pointId: p.id } })).toBe(0);
      expect(photoId).toBeTruthy();
      expect((await t.get(mapQuery(), bruno.token)).body).toHaveLength(0);
      expect(await t.prisma.pointRating.count()).toBe(1);
      expect(await t.prisma.checkIn.count({ where: { pointId: p.id } })).toBe(1);
    });

    it('excluir a conta do visitante libera o check-in aberto e apaga seus comentários', async () => {
      const p = await create(host, body());
      const done = await visit(bruno, p.id);
      await end(bruno, done);
      await rate(bruno, done, 4, 'Gostei muito');
      const c = await checkIn(ana, p.id);
      expect(c.status).toBe(201);
      expect((await t.request('DELETE', '/me', ana.token)).status).toBe(204);
      expect(
        (await t.prisma.checkIn.findUniqueOrThrow({ where: { id: c.body.checkIn.id } })).endedAt,
      ).not.toBeNull();
      expect((await t.request('DELETE', '/me', bruno.token)).status).toBe(204);
      expect((await t.prisma.pointRating.findFirstOrThrow()).comment).toBeNull();
    });
  });
});
