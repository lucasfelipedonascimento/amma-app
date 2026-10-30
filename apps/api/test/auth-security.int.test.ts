import { JwtService } from '@nestjs/jwt';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthGuard } from '../src/auth/auth.guard';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_FAILED_PER_HOUR,
  OTP_MAX_REQUESTS_PER_DAY,
} from '../src/auth/otp';
import { TestApp } from './helpers';

const PHONE = '+5583988880001';

describe('segurança da autenticação (Parte 1 da auditoria)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const requestCode = async (phone = PHONE) =>
    (await t.post('/auth/otp/request', undefined, { phone })).body.devCode as string;
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

  describe('OTP: tentativas e limites', () => {
    it('chutes em paralelo não furam o limite de tentativas (H2)', async () => {
      const code = await requestCode();
      const results = await Promise.all(
        Array.from({ length: 40 }, () =>
          t.post('/auth/otp/verify', undefined, { phone: PHONE, code: wrong(code) }),
        ),
      );
      expect(results.every((r) => r.status === 401)).toBe(true);
      const rec = await t.prisma.otpCode.findFirstOrThrow({ where: { phone: PHONE } });
      expect(rec.attempts).toBe(OTP_MAX_ATTEMPTS); // exatamente 5, não 40
      // Com as tentativas esgotadas, nem o código certo entra.
      const ok = await t.post('/auth/otp/verify', undefined, { phone: PHONE, code });
      expect(ok.status).toBe(401);
    });

    it('código certo entra uma vez só, mesmo com requisições paralelas', async () => {
      const code = await requestCode();
      const rs = await Promise.all(
        Array.from({ length: 10 }, () =>
          t.post('/auth/otp/verify', undefined, { phone: PHONE, code }),
        ),
      );
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('erros somados de vários códigos travam o telefone por uma hora', async () => {
      const code = await requestCode();
      await t.prisma.otpCode.create({
        data: {
          phone: PHONE,
          codeHash: 'x',
          expiresAt: new Date(Date.now() + 60_000),
          attempts: OTP_MAX_FAILED_PER_HOUR,
        },
      });
      const r = await t.post('/auth/otp/verify', undefined, { phone: PHONE, code });
      expect(r.status).toBe(429);
    });

    it('teto diário de códigos por telefone', async () => {
      await t.prisma.otpCode.createMany({
        data: Array.from({ length: OTP_MAX_REQUESTS_PER_DAY }, () => ({
          phone: PHONE,
          codeHash: 'x',
          expiresAt: new Date(Date.now() - 3_600_000),
          // fora da janela de 10 min, dentro de 24 h
          createdAt: new Date(Date.now() - 3_600_000),
        })),
      });
      expect((await t.post('/auth/otp/request', undefined, { phone: PHONE })).status).toBe(429);
    });
  });

  describe('limite de taxa por IP (H1)', () => {
    it('bloqueia o excesso em /auth/otp/request com Retry-After', async () => {
      const prev = process.env.RATE_LIMIT_SCALE;
      process.env.RATE_LIMIT_SCALE = '1';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 12; i++) {
          const res = await fetch(`${t.baseUrl}/auth/otp/request`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ phone: `+55839${String(90000000 + i)}` }),
          });
          statuses.push(res.status);
          if (res.status === 429) expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        }
        expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
        expect(statuses.slice(10)).toEqual([429, 429]);
      } finally {
        process.env.RATE_LIMIT_SCALE = prev;
      }
    });
  });

  describe('JWT (H6)', () => {
    it('token do login vale; sem emissor/audiência ou de outro segredo não vale', async () => {
      const u = await t.client();
      expect((await t.get('/me', u.token)).status).toBe(200);
      // Mesmo segredo, mas sem iss/aud: um token "forjado" por quem tivesse o segredo de outro serviço.
      const bare = await new JwtService({ secret: process.env.JWT_SECRET }).signAsync({
        sub: u.id,
      });
      expect((await t.get('/me', bare)).status).toBe(401);
      const other = await new JwtService({
        secret: 'outro-segredo-qualquer-0123456789ab',
      }).signAsync({ sub: u.id }, { issuer: 'amma-api', audience: 'amma-app' });
      expect((await t.get('/me', other)).status).toBe(401);
    });

    it('token com alg=none é recusado', async () => {
      const u = await t.client();
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
        sub: u.id,
        iss: 'amma-api',
        aud: 'amma-app',
        exp: Math.floor(Date.now() / 1000) + 600,
      })}.`;
      expect((await t.get('/me', forged)).status).toBe(401);
    });
  });

  describe('sair de todos os aparelhos (H7)', () => {
    it('logout-all revoga todos os refresh tokens', async () => {
      const login = async () => {
        const code = await requestCode();
        return (await t.post('/auth/otp/verify', undefined, { phone: PHONE, code })).body;
      };
      const a = await login();
      const b = await login();
      expect((await t.post('/auth/logout-all', a.accessToken)).status).toBe(204);
      expect(
        (await t.post('/auth/refresh', undefined, { refreshToken: a.refreshToken })).status,
      ).toBe(401);
      expect(
        (await t.post('/auth/refresh', undefined, { refreshToken: b.refreshToken })).status,
      ).toBe(401);
      expect((await t.post('/auth/logout-all')).status).toBe(401);
    });
  });

  describe('reautenticação do admin por OTP (H3)', () => {
    it('ação crítica sem reautenticação → 403 REAUTH_REQUIRED; com código → libera', async () => {
      const admin = await t.adminStale();
      const target = await t.client('Alvo');
      const denied = await t.post(`/admin/users/${target.id}/block`, admin.token, {
        reason: 'bloqueio de teste de segurança',
      });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('REAUTH_REQUIRED');

      const req = await t.post('/auth/reauth/request', admin.token);
      expect(req.status).toBe(200);
      const bad = await t.post('/auth/reauth/verify', admin.token, {
        code: wrong(req.body.devCode),
      });
      expect(bad.status).toBe(401);
      expect(
        (
          await t.post(`/admin/users/${target.id}/block`, admin.token, {
            reason: 'bloqueio de teste de segurança',
          })
        ).status,
      ).toBe(403);

      const ok = await t.post('/auth/reauth/verify', admin.token, { code: req.body.devCode });
      expect(ok.status).toBe(200);
      const done = await t.post(`/admin/users/${target.id}/block`, admin.token, {
        reason: 'bloqueio de teste de segurança',
      });
      expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
    });

    it('o código vai para o telefone da própria conta, nunca para um informado', async () => {
      const admin = await t.adminStale();
      // Um telefone no corpo é ignorado: o destino é sempre o da conta.
      const ok = await t.post('/auth/reauth/request', admin.token, { phone: '+5583988889999' });
      const rec = await t.prisma.otpCode.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      expect(rec.phone).toBe(admin.phone);
      expect(ok.status).toBe(200);
    });

    it('logout-all também derruba a reautenticação', async () => {
      const admin = await t.admin(); // já reautenticado
      const target = await t.client('Alvo');
      await t.post('/auth/logout-all', admin.token);
      const r = await t.post(`/admin/users/${target.id}/block`, admin.token, { reason: 'x' });
      expect(r.body.code).toBe('REAUTH_REQUIRED');
    });

    it('passageiro não consegue usar a reautenticação para chegar no admin', async () => {
      const c = await t.client();
      await t.reauth(c.id);
      expect((await t.post(`/admin/users/${c.id}/block`, c.token, { reason: 'x' })).status).toBe(
        403,
      );
    });
  });

  describe('negar por padrão (H5)', () => {
    it('toda rota tem AuthGuard ou @Public(), e as públicas são só as esperadas', () => {
      const open: string[] = [];
      for (const mod of t.app.get(ModulesContainer).values()) {
        for (const { metatype } of mod.controllers.values()) {
          if (!metatype) continue;
          const classGuards = (Reflect.getMetadata(GUARDS_METADATA, metatype) ?? []) as unknown[];
          const base = Reflect.getMetadata(PATH_METADATA, metatype) as string;
          for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
            const fn = metatype.prototype[name];
            if (
              name === 'constructor' ||
              typeof fn !== 'function' ||
              Reflect.getMetadata(PATH_METADATA, fn) === undefined
            )
              continue;
            const guards = [
              ...classGuards,
              ...((Reflect.getMetadata(GUARDS_METADATA, fn) ?? []) as unknown[]),
            ];
            const isPublic =
              Reflect.getMetadata('isPublic', fn) || Reflect.getMetadata('isPublic', metatype);
            if (!guards.includes(AuthGuard) && !isPublic)
              throw new Error(`Rota sem guard: ${metatype.name}.${name}`);
            if (isPublic)
              open.push(
                `${base}/${Reflect.getMetadata(PATH_METADATA, fn)}`
                  .replace(/\/+/g, '/')
                  .replace(/^\//, ''),
              );
          }
        }
      }
      expect(open.sort()).toEqual(
        [
          'health',
          'auth/otp/request',
          'auth/otp/verify',
          'auth/refresh',
          'auth/logout',
          'legal/privacy-policy',
          'dispatch/rules',
          'share/:token',
          'share/:token/data',
        ].sort(),
      );
    });

    it('rota autenticada sem token → 401; token de conta excluída → 401', async () => {
      expect((await t.get('/me')).status).toBe(401);
      const u = await t.client();
      await t.prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
      expect((await t.get('/me', u.token)).status).toBe(401);
    });
  });
});
