import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp, type TestUser } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.4 teste');

describe('seguro mútuo: pedido, anexos, acompanhamento e decisão humana', () => {
  let t: TestApp;
  let admin: TestUser;
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.admin();
    a = await t.member('Ana', 4);
    b = await t.member('Bruno', 4);
  });

  const body = (extra: object = {}) => ({
    kind: 'ACIDENTE',
    occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    description: 'Caí da moto na Av. Epitácio Pessoa e quebrei a carenagem.',
    requestedCents: 800_00,
    ...extra,
  });
  const create = async (u = a, extra: object = {}) =>
    (await t.post('/insurance/claims', u.token, body(extra))).body;
  const upload = (path: string, token: string, data: Buffer, mime = 'image/png') => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(data)], { type: mime }), 'anexo');
    return fetch(`${t.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  };
  const review = (id: string, u = admin) => t.post(`/admin/insurance/claims/${id}/review`, u.token);
  const decide = (id: string, b: object, u = admin) =>
    t.post(`/admin/insurance/claims/${id}/decision`, u.token, b);
  const approve = {
    decision: 'APROVADA',
    note: 'Fotos e boletim conferem com o relato.',
    approvedCents: 600_00,
  };

  describe('pedir', () => {
    it('sócio abre o pedido: nasce ENVIADA, com a linha do tempo começando', async () => {
      const r = await t.post('/insurance/claims', a.token, body());
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        status: 'ENVIADA',
        requestedCents: 800_00,
        approvedCents: null,
        attachments: [],
      });
      expect(r.body.timeline).toEqual([expect.objectContaining({ from: null, to: 'ENVIADA' })]);
    });

    it('quem não é sócio não pede (sem cota), nem passageiro', async () => {
      expect(
        (await t.post('/insurance/claims', (await t.driver('SemCota')).token, body())).status,
      ).toBe(403);
      expect((await t.post('/insurance/claims', (await t.client()).token, body())).status).toBe(
        403,
      );
    });

    it.each([
      [{ occurredAt: new Date(Date.now() + 86_400_000).toISOString() }],
      [{ description: 'curto' }],
      [{ requestedCents: 0 }],
      [{ requestedCents: 10.5 }],
      [{ kind: 'INCENDIO' }],
      [{ occurredAt: 'ontem' }],
    ])('dados inválidos %j', async (extra) => {
      expect((await t.post('/insurance/claims', a.token, body(extra))).status).toBe(400);
      expect(await t.prisma.insuranceClaim.count()).toBe(0);
    });

    it('cada sócio vê só os próprios pedidos', async () => {
      const mine = await create(a);
      await create(b);
      expect((await t.get('/insurance/claims', a.token)).body.map((c: any) => c.id)).toEqual([
        mine.id,
      ]);
      expect((await t.get(`/insurance/claims/${mine.id}`, b.token)).status).toBe(404);
    });
  });

  describe('anexos', () => {
    it('aceita JPG, PNG e PDF e lista no pedido', async () => {
      const c = await create();
      expect((await upload(`/insurance/claims/${c.id}/attachments`, a.token, PNG)).status).toBe(
        201,
      );
      expect(
        (await upload(`/insurance/claims/${c.id}/attachments`, a.token, PDF, 'application/pdf'))
          .status,
      ).toBe(201);
      const got = (await t.get(`/insurance/claims/${c.id}`, a.token)).body;
      expect(got.attachments.map((x: any) => x.mimeType)).toEqual(['image/png', 'application/pdf']);
    });

    it('confere o conteúdo real do arquivo, não o tipo informado', async () => {
      const c = await create();
      const r = await upload(
        `/insurance/claims/${c.id}/attachments`,
        a.token,
        Buffer.from('MZ executável'),
        'image/png',
      );
      expect(r.status).toBe(400);
    });

    it('sem arquivo, arquivo grande ou além do limite de 8', async () => {
      const c = await create();
      const path = `/insurance/claims/${c.id}/attachments`;
      expect((await t.post(path, a.token, {})).status).toBe(400);
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      expect((await upload(path, a.token, big)).status).toBeGreaterThanOrEqual(400);
      for (let i = 0; i < 8; i++) expect((await upload(path, a.token, PNG)).status).toBe(201);
      expect((await upload(path, a.token, PNG)).status).toBe(409);
    });

    it('só o dono anexa; o arquivo é baixado pelo dono e pelo admin, não por outro sócio', async () => {
      const c = await create();
      expect((await upload(`/insurance/claims/${c.id}/attachments`, b.token, PNG)).status).toBe(
        404,
      );
      const att = await (
        await upload(`/insurance/claims/${c.id}/attachments`, a.token, PNG)
      ).json();
      const mine = await fetch(`${t.baseUrl}/insurance/claims/${c.id}/attachments/${att.id}`, {
        headers: { authorization: `Bearer ${a.token}` },
      });
      expect(mine.status).toBe(200);
      expect(mine.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await mine.arrayBuffer()).equals(PNG)).toBe(true);
      expect((await t.get(`/insurance/claims/${c.id}/attachments/${att.id}`, b.token)).status).toBe(
        404,
      );
      const adm = await fetch(`${t.baseUrl}/admin/insurance/claims/${c.id}/attachments/${att.id}`, {
        headers: { authorization: `Bearer ${admin.token}` },
      });
      expect(adm.status).toBe(200);
    });

    it('não recebe anexo depois de decidido ou cancelado', async () => {
      const c = await create();
      await review(c.id);
      await decide(c.id, approve);
      expect((await upload(`/insurance/claims/${c.id}/attachments`, a.token, PNG)).status).toBe(
        409,
      );
    });
  });

  describe('acompanhamento e decisão humana', () => {
    it('fluxo completo: enviada → em análise → aprovada, tudo na linha do tempo', async () => {
      const c = await create();
      expect((await review(c.id)).body.status).toBe('EM_ANALISE');
      const r = await decide(c.id, approve);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        status: 'APROVADA',
        approvedCents: 600_00,
        decisionNote: approve.note,
      });
      const mine = (await t.get(`/insurance/claims/${c.id}`, a.token)).body;
      expect(mine.timeline.map((e: any) => e.to)).toEqual(['ENVIADA', 'EM_ANALISE', 'APROVADA']);
      expect(mine.timeline[2]).toMatchObject({ from: 'EM_ANALISE', note: approve.note });
      const row = await t.prisma.insuranceClaim.findUniqueOrThrow({ where: { id: c.id } });
      expect(row.decidedById).toBe(admin.id);
      expect(row.decidedAt).toBeTruthy();
    });

    it('negar exige motivo e não leva valor', async () => {
      const c = await create();
      await review(c.id);
      expect((await decide(c.id, { decision: 'NEGADA', note: 'curto' })).status).toBe(400);
      expect(
        (
          await decide(c.id, {
            decision: 'NEGADA',
            note: 'Fora da cobertura prevista.',
            approvedCents: 1,
          })
        ).status,
      ).toBe(400);
      const r = await decide(c.id, {
        decision: 'NEGADA',
        note: 'Fora da cobertura prevista no regulamento.',
      });
      expect(r.body).toMatchObject({ status: 'NEGADA', approvedCents: null });
    });

    it('aprovar exige valor, positivo e no máximo o pedido', async () => {
      const c = await create();
      await review(c.id);
      const note = 'Documentação conferida pela comissão.';
      expect((await decide(c.id, { decision: 'APROVADA', note })).status).toBe(400);
      expect(
        (await decide(c.id, { decision: 'APROVADA', note, approvedCents: 800_01 })).status,
      ).toBe(400);
      expect((await decide(c.id, { decision: 'APROVADA', note, approvedCents: 0 })).status).toBe(
        400,
      );
      expect(
        (await decide(c.id, { decision: 'APROVADA', note, approvedCents: 800_00 })).status,
      ).toBe(200);
    });

    it('a decisão nunca é automática nem pula a análise', async () => {
      const c = await create();
      expect((await decide(c.id, approve)).status).toBe(409); // ENVIADA direto para decisão
      expect((await t.get(`/insurance/claims/${c.id}`, a.token)).body.status).toBe('ENVIADA');
    });

    it('decidido é final: nem reabre, nem decide de novo, nem cancela', async () => {
      const c = await create();
      await review(c.id);
      await decide(c.id, approve);
      expect(
        (await decide(c.id, { decision: 'NEGADA', note: 'Mudei de ideia sobre este.' })).status,
      ).toBe(409);
      expect((await review(c.id)).status).toBe(409);
      expect((await t.post(`/insurance/claims/${c.id}/cancel`, a.token)).status).toBe(409);
    });

    it('decisões simultâneas: só uma vale', async () => {
      const c = await create();
      await review(c.id);
      const rs = await Promise.all([
        decide(c.id, approve),
        decide(c.id, { decision: 'NEGADA', note: 'Negado pela comissão.' }),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await t.prisma.insuranceEvent.count({
          where: { claimId: c.id, toStatus: { in: ['APROVADA', 'NEGADA'] } },
        }),
      ).toBe(1);
    });

    it('quem pediu não analisa nem decide o próprio pedido (mesmo sendo admin)', async () => {
      const both = await t.user(['ADMIN', 'MOTORISTA'], 'Admin Sócio');
      await t.giveQuotas(both.id, 3);
      const mine = await create(both);
      expect((await review(mine.id, both)).status).toBe(403);
      await review(mine.id);
      expect((await decide(mine.id, approve, both)).status).toBe(403);
      expect((await decide(mine.id, approve)).status).toBe(200); // outro admin decide
    });

    it('sócio comum não analisa nem decide: só admin', async () => {
      const c = await create();
      expect((await review(c.id, b)).status).toBe(403);
      expect((await review(c.id, a)).status).toBe(403);
      expect((await t.get(`/admin/insurance/claims`, a.token)).status).toBe(403);
    });

    it('o sócio cancela até a decisão', async () => {
      const c = await create();
      await review(c.id);
      const r = await t.post(`/insurance/claims/${c.id}/cancel`, a.token);
      expect(r.body.status).toBe('CANCELADA');
      expect(r.body.timeline.at(-1)).toMatchObject({ to: 'CANCELADA' });
      expect((await t.post(`/insurance/claims/${c.id}/cancel`, b.token)).status).toBe(404);
    });

    it('o admin vê a fila de pedidos, filtra por estado e vê quem pediu', async () => {
      const c1 = await create(a);
      const c2 = await create(b);
      await review(c2.id);
      const all = (await t.get('/admin/insurance/claims', admin.token)).body;
      expect(all.map((c: any) => c.id)).toEqual([c1.id, c2.id]);
      expect(all[0].claimant.name).toBe('Ana');
      const analyzing = (await t.get('/admin/insurance/claims?status=EM_ANALISE', admin.token))
        .body;
      expect(analyzing.map((c: any) => c.id)).toEqual([c2.id]);
      expect((await t.get('/admin/insurance/claims?status=XYZ', admin.token)).status).toBe(400);
    });

    it('a linha do tempo é somente inserção', async () => {
      const c = await create();
      const ev = await t.prisma.insuranceEvent.findFirstOrThrow({ where: { claimId: c.id } });
      await expect(
        t.prisma.insuranceEvent.update({ where: { id: ev.id }, data: { note: 'x' } }),
      ).rejects.toThrow();
      await expect(t.prisma.insuranceEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
    });

    it('o banco recusa valor aprovado acima do pedido', async () => {
      const c = await create();
      await expect(
        t.prisma.insuranceClaim.update({ where: { id: c.id }, data: { approvedCents: 900_00 } }),
      ).rejects.toThrow();
    });
  });

  it('excluir a conta apaga os anexos (arquivos também) e o texto do pedido, e mantém a decisão', async () => {
    const c = await create();
    await upload(`/insurance/claims/${c.id}/attachments`, a.token, PNG);
    await review(c.id);
    await decide(c.id, approve);
    const files = () => readdirSync(process.env.UPLOAD_DIR!).filter((f) => f.endsWith('.png'));
    const before = files().length;
    expect(before).toBeGreaterThan(0);
    expect((await t.req('DELETE', '/me', a.token)).status).toBeLessThan(300);
    expect(await t.prisma.insuranceAttachment.count()).toBe(0);
    expect(files().length).toBe(before - 1);
    const row = await t.prisma.insuranceClaim.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.description).toMatch(/removido/);
    expect(row).toMatchObject({ status: 'APROVADA', approvedCents: 600_00 });
  });
});
