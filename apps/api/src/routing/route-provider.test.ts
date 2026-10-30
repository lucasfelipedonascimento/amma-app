import { describe, expect, it, vi } from 'vitest';
import {
  MapboxRouteProvider,
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
