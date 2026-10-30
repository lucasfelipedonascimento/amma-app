// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const jwt = (expSeconds: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`;
const inMinutes = (m: number) => Math.floor(Date.now() / 1000) + m * 60;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('middleware: sessão', () => {
  const run = async (headers: Record<string, string>, path = '/motoristas') => {
    const { middleware } = await import('./middleware');
    return middleware(new NextRequest(`http://localhost:3001${path}`, { headers }));
  };

  it('token fresco passa sem chamar a API', async () => {
    const res = await run({ cookie: `amma_at=${jwt(inMinutes(10))}; amma_rt=r` });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem cookies, página manda para /login e API devolve 401', async () => {
    const page = await run({});
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe('http://localhost:3001/login');
    const api = await run({}, '/api/proxy/admin/users');
    expect(api.status).toBe(401);
  });

  it('token vencido é renovado e os cookies novos seguem para a requisição e o navegador', async () => {
    fetchMock.mockResolvedValue(json({ accessToken: jwt(inMinutes(15)), refreshToken: 'novo-rt' }));
    const res = await run({ cookie: `amma_at=${jwt(inMinutes(-1))}; amma_rt=velho-rt` });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      expect.objectContaining({ body: JSON.stringify({ refreshToken: 'velho-rt' }) }),
    );
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('amma_rt=novo-rt');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=strict');
    expect(res.headers.get('x-middleware-request-cookie')).toContain('amma_rt=novo-rt');
  });

  it('renovação recusada encerra a sessão', async () => {
    fetchMock.mockResolvedValue(json({ message: 'x' }, 401));
    const res = await run({ cookie: `amma_rt=revogado` });
    expect(res.status).toBe(307);
    expect(res.headers.get('set-cookie')).toContain('amma_rt=;');
  });

  it('API fora do ar não deixa entrar', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    expect((await run({ cookie: 'amma_rt=r' })).status).toBe(307);
  });
});

describe('proxy da API', () => {
  const call = async (
    path: string[],
    init: { method?: string; origin?: string | null; cookie?: string; body?: string } = {},
  ) => {
    const mod = await import('./app/api/proxy/[...path]/route');
    const method = init.method ?? 'GET';
    const req = new NextRequest(`http://localhost:3001/api/proxy/${path.join('/')}?x=1`, {
      method,
      headers: {
        host: 'localhost:3001',
        ...(init.origin !== null && method !== 'GET'
          ? { origin: init.origin ?? 'http://localhost:3001' }
          : {}),
        cookie: init.cookie ?? 'amma_at=tok',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body,
    });
    const handler = method === 'GET' ? mod.GET : mod.POST;
    return handler(req, { params: Promise.resolve({ path }) });
  };

  it('repassa com o token de dentro do cookie e a query', async () => {
    fetchMock.mockResolvedValue(
      new Response('[1]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const res = await call(['admin', 'users']);
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/admin/users?x=1');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('recusa rotas fora de /admin e /panel', async () => {
    expect((await call(['auth', 'refresh'])).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa escrita vinda de outro site ou sem Origin', async () => {
    expect(
      (
        await call(['admin', 'users', 'x', 'block'], {
          method: 'POST',
          origin: 'https://evil.example',
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(['admin', 'users', 'x', 'block'], { method: 'POST', origin: null, body: '{}' }))
        .status,
    ).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem cookie de sessão, 401', async () => {
    expect((await call(['admin', 'users'], { cookie: '' })).status).toBe(401);
  });

  it('repassa o erro da API como veio', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Sem permissão para o painel' }, 403));
    const res = await call(['admin', 'audit']);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: 'Sem permissão para o painel' });
  });
});

describe('login: só admin e sócio ganham sessão', () => {
  const verify = async () => {
    const { POST } = await import('./app/api/auth/verify/route');
    return POST(
      new Request('http://localhost:3001/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ phone: '+5583999990000', code: '123456' }),
      }),
    );
  };

  it('com papel de painel: cookies httpOnly', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 'at', refreshToken: 'rt' }))
      .mockResolvedValueOnce(json({ id: '1', name: 'Ana', panelRoles: ['ADMIN'] }));
    const res = await verify();
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie().join('\n');
    expect(cookies).toContain('amma_at=at');
    expect(cookies).toContain('amma_rt=rt');
    expect(cookies.toLowerCase()).toContain('httponly');
  });

  it('sem papel de painel: 403, sem cookie, e a sessão da API é encerrada', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 'at', refreshToken: 'rt' }))
      .mockResolvedValueOnce(json({ id: '1', name: 'Zé', panelRoles: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await verify();
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(fetchMock.mock.calls[2][0]).toContain('/auth/logout');
  });

  it('código errado: repassa o erro da API', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'Código inválido' }, 401));
    expect((await verify()).status).toBe(401);
  });
});
