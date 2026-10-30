import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { TestApp, WsClient, near } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const pdf = (body: string) => Buffer.from(`%PDF-1.4\n${body}\n%%EOF`);

describe('WebSocket, localização, arquivos e LGPD (Parte 3 da auditoria)', () => {
  let t: TestApp;
  const sockets: WsClient[] = [];
  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await t.reset();
  });

  const connect = async (token?: string) => {
    const ws = await WsClient.connect(t.wsUrl);
    sockets.push(ws);
    if (token) await ws.authenticate(token);
    return ws;
  };
  const upload = (
    path: string,
    token: string,
    data: Buffer,
    filename = 'x.png',
    mime = 'image/png',
    fields: Record<string, string> = {},
  ) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new Blob([new Uint8Array(data)], { type: mime }), filename);
    return fetch(`${t.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  };

  // ------------------------------------------------------------------ WebSocket
  describe('WebSocket', () => {
    it('no máximo 3 conexões autenticadas por usuário', async () => {
      const u = await t.client();
      for (let i = 0; i < 3; i++) await connect(u.token);
      const fourth = await connect();
      fourth.send('auth', { token: u.token });
      expect(await fourth.closed).toBe(4429);
    });

    it('origem de navegador não autorizada é recusada; sem Origin (app nativo) passa', async () => {
      const bad = new WebSocket(t.wsUrl, { origin: 'https://site-malicioso.example' });
      const code = await new Promise<number>((resolve) => bad.on('close', resolve));
      expect(code).toBe(4403);
      const u = await t.client();
      expect((await connect(u.token)).socket.readyState).toBe(WebSocket.OPEN);
    });

    it('conta bloqueada, excluída ou que saiu de todos os aparelhos perde a conexão aberta', async () => {
      const blocked = await t.client('Bloqueada');
      const deleted = await t.client('Excluída');
      const out = await t.client('Saiu');
      const ok = await t.client('Normal');
      const [wb, wd, wo, wn] = await Promise.all(
        [blocked, deleted, out, ok].map((u) => connect(u.token)),
      );
      await t.prisma.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
      await t.prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
      expect((await t.post('/auth/logout-all', out.token)).status).toBe(204);
      expect(await Promise.all([wb.closed, wd.closed, wo.closed])).toEqual([4401, 4401, 4401]);
      expect(wn.socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  // ------------------------------------------------------------------ consentimento de localização
  describe('consentimento de localização exigido no servidor', () => {
    it('sem consentimento não fica online (403); com consentimento, sim', async () => {
      const d = await t.driver('Maria');
      const denied = await t.post('/driver/presence/online', d.token, near(100));
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('LOCATION_CONSENT_REQUIRED');
      expect(await t.prisma.driverPresence.count({ where: { online: true } })).toBe(0);
      await t.consentLocation(d.id);
      expect((await t.post('/driver/presence/online', d.token, near(100))).status).toBe(200);
    });

    it('revogar o consentimento tira o motorista do ar e apaga a posição', async () => {
      const d = await t.driver('Maria');
      await t.online(d, near(100));
      expect((await t.del('/driver/location-consent', d.token)).status).toBe(204);
      const p = await t.prisma.$queryRaw<{ online: boolean; has: boolean }[]>`
        SELECT online, location IS NOT NULL AS has FROM "DriverPresence" WHERE "userId" = ${d.id}`;
      expect(p[0]).toEqual({ online: false, has: false });
      expect((await t.post('/driver/position', d.token, near(100))).body.accepted).toBe(false);
    });
  });

  // ------------------------------------------------------------------ arquivos
  describe('uploads e documentos', () => {
    it('PDF com JavaScript ou ação automática é recusado; PDF comum passa', async () => {
      const d = await t.driver('Maria', { approved: false });
      for (const bad of [
        '/JavaScript (app.alert(1))',
        '/JS (x)',
        '/OpenAction << /S /Launch >>',
        '/EmbeddedFile',
      ]) {
        const r = await upload(
          '/driver/documents',
          d.token,
          pdf(`1 0 obj << ${bad} >> endobj`),
          'cnh.pdf',
          'application/pdf',
          { type: 'CNH' },
        );
        expect(r.status, bad).toBe(400);
      }
      const ok = await upload(
        '/driver/documents',
        d.token,
        pdf('1 0 obj << /Type /Catalog >> endobj'),
        'cnh.pdf',
        'application/pdf',
        { type: 'CNH' },
      );
      expect(ok.status).toBe(201);
    });

    it('nome de arquivo do cliente nunca vira caminho', async () => {
      const d = await t.driver('Maria', { approved: false });
      const r = await upload(
        '/driver/documents',
        d.token,
        PNG,
        '../../../etc/passwd',
        'image/png',
        { type: 'FOTO' },
      );
      expect(r.status).toBe(201);
      const doc = await t.prisma.document.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      expect(doc.storageKey).toMatch(/^[0-9a-f-]{36}\.png$/);
    });

    it('limite de documentos por conta', async () => {
      const d = await t.driver('Maria', { approved: false });
      await t.prisma.document.createMany({
        data: Array.from({ length: 50 }, () => ({
          userId: d.id,
          type: 'FOTO' as const,
          storageKey: 'x.png',
          mimeType: 'image/png',
          sizeBytes: 8,
        })),
      });
      const r = await upload('/driver/documents', d.token, PNG, 'f.png', 'image/png', {
        type: 'FOTO',
      });
      expect(r.status).toBe(409);
    });

    it('admin baixa o documento como anexo, isolado, e a abertura fica na trilha', async () => {
      const admin = await t.admin();
      const d = await t.driver('Maria', { approved: false });
      const up = await upload('/driver/documents', d.token, PNG, 'f.png', 'image/png', {
        type: 'FOTO',
      });
      const id = (await up.json()).id as string;
      const res = await fetch(`${t.baseUrl}/admin/documents/${id}/file`, {
        headers: { authorization: `Bearer ${admin.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
      expect(
        await t.prisma.auditLog.count({
          where: { actorId: admin.id, action: 'GET /admin/documents/:id/file' },
        }),
      ).toBe(1);
      // Quem não é admin não baixa.
      const other = await t.driver('Outro');
      expect(
        (
          await fetch(`${t.baseUrl}/admin/documents/${id}/file`, {
            headers: { authorization: `Bearer ${other.token}` },
          })
        ).status,
      ).toBe(403);
    });
  });

  // ------------------------------------------------------------------ LGPD: exportação
  describe('GET /me/export', () => {
    it('devolve só os dados do titular, sem terceiros nem segredos', async () => {
      const client = await t.client('Cliente');
      const other = await t.client('Outro cliente');
      const driver = await t.driver('Maria');
      await t.online(driver, near(100));
      const id = await t.runToDelivered(client, driver);
      await t.post(`/deliveries/${id}/rating`, client.token, {
        stars: 5,
        comment: 'Excelente motorista',
      });
      await t.createDelivery(other).catch(() => undefined);

      const c = await t.get('/me/export', client.token);
      expect(c.status).toBe(200);
      expect(c.body.account).toMatchObject({ id: client.id, phone: client.phone });
      expect(c.body.orders.asClient).toHaveLength(1);
      expect(c.body.orders.asClient[0]).toMatchObject({ id, pickupAddress: expect.any(String) });
      expect(c.body.ratingsGiven[0]).toMatchObject({ stars: 5, comment: 'Excelente motorista' });

      const d = await t.get('/me/export', driver.token);
      expect(d.body.driver.profile.cpf).toBeTruthy();
      expect(d.body.orders.asDriver).toHaveLength(1);
      expect(d.body.orders.asDriver[0]).not.toHaveProperty('pickupAddress'); // endereço do cliente não é do motorista
      expect(d.body.ratingsGiven).toEqual([]); // o comentário que ele RECEBEU não aparece
      expect(d.body.accounting.ledgerEntries.length).toBeGreaterThan(0);

      for (const body of [c.body, d.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toMatch(/storageKey|providerRef|pushToken|tokenHash|boardingPin/);
        expect(text).not.toContain(other.id);
      }
    });

    it('exige login, funciona para conta bloqueada e tem limite diário', async () => {
      expect((await t.get('/me/export')).status).toBe(401);
      const u = await t.client();
      await t.prisma.user.update({ where: { id: u.id }, data: { blockedAt: new Date() } });
      expect((await t.get('/me/export', u.token)).status).toBe(200);
      const prev = process.env.RATE_LIMIT_SCALE;
      process.env.RATE_LIMIT_SCALE = '1';
      try {
        const u2 = await t.client();
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await t.get('/me/export', u2.token)).status);
        expect(statuses).toEqual([200, 200, 200, 429]);
      } finally {
        process.env.RATE_LIMIT_SCALE = prev;
      }
    });
  });
});
