import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { haversineMeters, type GeoPoint } from '@amma/shared';

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
}

/** Rota entre dois pontos. Trocar de provedor = implementar esta interface. */
export interface RouteProvider {
  route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult>;
}

export const ROUTE_PROVIDER = Symbol('ROUTE_PROVIDER');

export class RouteUnavailableError extends Error {}

/** Versão simulada (testes e desenvolvimento): determinística, sem rede. */
export class SimulatedRouteProvider implements RouteProvider {
  /** A rota real é mais longa que a reta; 1,3 é uma aproximação urbana comum. */
  static readonly DETOUR_FACTOR = 1.3;
  /** 25 km/h de média urbana de moto. */
  static readonly SPEED_MPS = 25_000 / 3600;

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult> {
    const distanceMeters = Math.round(
      haversineMeters(origin, destination) * SimulatedRouteProvider.DETOUR_FACTOR,
    );
    return {
      distanceMeters,
      durationSeconds: Math.ceil(distanceMeters / SimulatedRouteProvider.SPEED_MPS),
    };
  }
}

/**
 * Mapbox Directions API (perfil "driving"). Precisa de MAPBOX_ACCESS_TOKEN.
 * Distância e duração são arredondadas PARA CIMA (em favor do trabalhador, como no preço).
 */
export class MapboxRouteProvider implements RouteProvider {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult> {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=false&access_token=${encodeURIComponent(this.token)}`;
    let body: { code?: string; routes?: { distance?: number; duration?: number }[] };
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      // Nunca incluir a URL na mensagem: ela carrega o token.
      if (!res.ok) throw new RouteUnavailableError(`Mapbox respondeu HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      if (e instanceof RouteUnavailableError) throw e;
      throw new RouteUnavailableError('Falha ao consultar o Mapbox');
    }
    const r = body.routes?.[0];
    if (body.code !== 'Ok' || r?.distance === undefined || r.duration === undefined)
      throw new RouteUnavailableError(`Mapbox sem rota (${body.code ?? 'resposta inválida'})`);
    return { distanceMeters: Math.ceil(r.distance), durationSeconds: Math.ceil(r.duration) };
  }
}

/** ROUTE_PROVIDER=simulated (padrão) | mapbox. O simulado é recusado em produção. */
export function createRouteProvider(config: ConfigService): RouteProvider {
  const mode = config.get<string>('ROUTE_PROVIDER') ?? 'simulated';
  if (mode === 'simulated') {
    if (config.get('NODE_ENV') === 'production')
      throw new Error('ROUTE_PROVIDER=simulated não pode ser usado em produção');
    new Logger('Rotas').warn('Usando provedor de rotas SIMULADO (ROUTE_PROVIDER=simulated)');
    return new SimulatedRouteProvider();
  }
  if (mode === 'mapbox') {
    const token = config.get<string>('MAPBOX_ACCESS_TOKEN');
    if (!token) throw new Error('MAPBOX_ACCESS_TOKEN não definido (ROUTE_PROVIDER=mapbox)');
    return new MapboxRouteProvider(token);
  }
  throw new Error(`ROUTE_PROVIDER inválido: ${mode}`);
}
