import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  createPushSender,
  EXPO_TOKEN_RE,
  ExpoPushSender,
  PushService,
  SimulatedPushSender,
} from './push.service';

const TOKEN = 'ExponentPushToken[abcdefghijklmnop]';
const ok = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('ExpoPushSender', () => {
  it('envia no formato do Expo e devolve os tokens inexistentes', async () => {
    const fetchFn = ok({
      data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
    });
    const sender = new ExpoPushSender('seg', fetchFn);
    const r = await sender.send(['t1', 't2'], { title: 'T', body: 'B', ttlSeconds: 30 });
    expect(r.invalidTokens).toEqual(['t2']);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ExpoPushSender.URL);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer seg');
    const sent = JSON.parse(init.body as string);
    expect(sent[0]).toMatchObject({ to: 't1', priority: 'high', channelId: 'offers', ttl: 30 });
  });

  it('erro HTTP vira exceção (o PushService engole)', async () => {
    await expect(
      new ExpoPushSender(undefined, ok({}, 500)).send(['t'], { title: '', body: '' }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('createPushSender', () => {
  const cfg = (v: Record<string, string>) => new ConfigService(v);
  it('simulado por padrão, mas recusado em produção', () => {
    expect(createPushSender(cfg({}))).toBeInstanceOf(SimulatedPushSender);
    expect(() => createPushSender(cfg({ NODE_ENV: 'production' }))).toThrow();
  });
  it('expo e valor inválido', () => {
    expect(createPushSender(cfg({ PUSH_MODE: 'expo' }))).toBeInstanceOf(ExpoPushSender);
    expect(() => createPushSender(cfg({ PUSH_MODE: 'x' }))).toThrow('inválido');
  });
});

describe('token do Expo', () => {
  it('aceita o formato do Expo e recusa lixo', () => {
    expect(EXPO_TOKEN_RE.test(TOKEN)).toBe(true);
    expect(EXPO_TOKEN_RE.test('qualquer coisa')).toBe(false);
  });
});

describe('PushService.notifyOffer', () => {
  const offer = {
    id: 'o1',
    expiresAt: new Date(Date.now() + 30_000),
    estimatedNetCents: 968,
    deliveryDistanceMeters: 2894,
  };

  it('manda valor líquido e distância, sem endereço, e remove token morto', async () => {
    const prisma = {
      pushToken: {
        findMany: vi.fn(async () => [{ token: 'a' }, { token: 'b' }]),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const sender = { send: vi.fn(async () => ({ invalidTokens: ['b'] })) };
    await new PushService(prisma as never, sender).notifyOffer('d1', offer);
    const [tokens, msg] = sender.send.mock.calls[0] as unknown as [
      string[],
      { body: string; data: unknown },
    ];
    expect(tokens).toEqual(['a', 'b']);
    expect(msg.body).toContain('9,68');
    expect(msg.body).toContain('2,9 km');
    expect(msg.data).toEqual({ type: 'offer', offerId: 'o1' });
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['b'] } } });
  });

  it('sem tokens não chama o serviço; falha do serviço não lança', async () => {
    const empty = { pushToken: { findMany: vi.fn(async () => []) } };
    const sender = { send: vi.fn(async () => ({ invalidTokens: [] })) };
    await new PushService(empty as never, sender).notifyOffer('d1', offer);
    expect(sender.send).not.toHaveBeenCalled();

    const one = { pushToken: { findMany: vi.fn(async () => [{ token: 'a' }]) } };
    const boom = {
      send: vi.fn(async () => {
        throw new Error('fora do ar');
      }),
    };
    await expect(
      new PushService(one as never, boom).notifyOffer('d1', offer),
    ).resolves.toBeUndefined();
  });
});
