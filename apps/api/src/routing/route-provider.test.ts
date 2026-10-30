import { describe, expect, it, vi } from 'vitest';
import {
  MapboxRouteProvider,
  OsrmRouteProvider,
  RouteUnavailableError,
  SimulatedRouteProvider,
} from './route-provider';

const A = { lat: -7.115, lng: -34.86 };
const B = { lat: -7.105, lng: -34.86 };

describe('SimulatedRouteProvider', () => {
  it('é determinístico e proporcional à distância', async () => {
    const p = new SimulatedRouteProvider();
    const r1 = await p.route(A, B);
    expect(await p.route(A, B)).toEqual(r1);
    // ~1112 m em linha reta * 1,3
    expect(r1.distanceMeters).toBeGreaterThan(1400);
    expect(r1.distanceMeters).toBeLessThan(1500);
    expect(r1.durationSeconds).toBe(Math.ceil(r1.distanceMeters / (25_000 / 3600)));
    expect(await p.route(A, A)).toEqual({ distanceMeters: 0, durationSeconds: 0 });
  });

  it('devolve o trajeto (reta) só quando pedido', async () => {
    const p = new SimulatedRouteProvider();
    expect((await p.route(A, B)).path).toBeUndefined();
    expect((await p.route(A, B, { withPath: true })).path).toEqual([A, B]);
  });
});

describe('MapboxRouteProvider', () => {
  const ok = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('monta a URL com lng,lat e arredonda para cima', async () => {
    const fetchFn = ok({ code: 'Ok', routes: [{ distance: 1500.2, duration: 301.1 }] });
    const r = await new MapboxRouteProvider('tok', fetchFn).route(A, B);
    expect(r).toEqual({ distanceMeters: 1501, durationSeconds: 302 });
    const url = String((fetchFn.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/driving/-34.86,-7.115;-34.86,-7.105');
    expect(url).toContain('access_token=tok');
  });

  it('com withPath pede a geometria e converte [lng,lat] em pontos', async () => {
    const fetchFn = ok({
      code: 'Ok',
      routes: [
        {
          distance: 100,
          duration: 20,
          geometry: {
            coordinates: [
              [-34.86, -7.115],
              [-34.86, -7.105],
            ],
          },
        },
      ],
    });
    const r = await new MapboxRouteProvider('tok', fetchFn).route(A, B, { withPath: true });
    expect(r.path).toEqual([A, B]);
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain(
      'overview=full&geometries=geojson',
    );
  });

  it('sem withPath não pede geometria', async () => {
    const fetchFn = ok({ code: 'Ok', routes: [{ distance: 1, duration: 1 }] });
    const r = await new MapboxRouteProvider('tok', fetchFn).route(A, B);
    expect(r.path).toBeUndefined();
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('overview=false');
  });

  it('erro HTTP, rede e resposta sem rota viram RouteUnavailableError sem vazar o token', async () => {
    const cases = [
      ok({ message: 'Not Authorized' }, 401),
      vi.fn(async () => {
        throw new Error('ECONNRESET https://api.mapbox.com/?access_token=segredo');
      }),
      ok({ code: 'NoRoute', routes: [] }),
      ok({ code: 'Ok', routes: [{}] }),
    ];
    for (const fetchFn of cases) {
      const err = await new MapboxRouteProvider('segredo', fetchFn)
        .route(A, B)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(RouteUnavailableError);
      expect((err as Error).message).not.toContain('segredo');
    }
  });
});

describe('OsrmRouteProvider', () => {
  const ok = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('monta a URL com lng,lat, devolve o traçado pelas ruas e arredonda para cima', async () => {
    const fetchFn = ok({
      code: 'Ok',
      routes: [
        {
          distance: 1500.2,
          duration: 301.1,
          geometry: {
            coordinates: [
              [-34.86, -7.115],
              [-34.859, -7.11],
              [-34.86, -7.105],
            ],
          },
        },
      ],
    });
    const r = await new OsrmRouteProvider('http://osrm.local/', fetchFn).route(A, B, {
      withPath: true,
    });
    expect(r.distanceMeters).toBe(1501);
    expect(r.durationSeconds).toBe(302);
    expect(r.path).toHaveLength(3);
    const url = String((fetchFn.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('http://osrm.local/route/v1/driving/-34.86,-7.115;-34.86,-7.105');
    expect(url).toContain('geometries=geojson');
  });

  it('sem rota ou erro de rede: RouteUnavailableError', async () => {
    await expect(
      new OsrmRouteProvider('http://x', ok({ code: 'NoRoute', routes: [] })).route(A, B),
    ).rejects.toBeInstanceOf(RouteUnavailableError);
    await expect(
      new OsrmRouteProvider(
        'http://x',
        vi.fn(async () => Promise.reject(new Error('rede'))),
      ).route(A, B),
    ).rejects.toBeInstanceOf(RouteUnavailableError);
  });
});
