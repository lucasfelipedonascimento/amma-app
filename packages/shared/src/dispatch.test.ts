import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPATCH_CONFIG,
  chooseCandidate,
  validateDispatchConfig,
  type DispatchCandidate,
} from './dispatch';
import { haversineMeters, isValidPoint } from './geo';

const cand = (over: Partial<DispatchCandidate> & { driverId: string }): DispatchCandidate => ({
  distanceMeters: 500,
  positionAgeSeconds: 5,
  approved: true,
  busy: false,
  alreadyTried: false,
  onlineSince: '2026-10-29T10:00:00Z',
  ...over,
});
const cfg = DEFAULT_DISPATCH_CONFIG;

describe('chooseCandidate', () => {
  it('escolhe o mais próximo', () => {
    const r = chooseCandidate(
      [
        cand({ driverId: 'a', distanceMeters: 900 }),
        cand({ driverId: 'b', distanceMeters: 300 }),
        cand({ driverId: 'c', distanceMeters: 600 }),
      ],
      cfg,
    );
    expect(r.chosen?.driverId).toBe('b');
    expect(r.eligible).toBe(3);
  });

  it('empate de distância: quem está online há mais tempo', () => {
    const r = chooseCandidate(
      [
        cand({ driverId: 'novo', onlineSince: '2026-10-29T11:00:00Z' }),
        cand({ driverId: 'antigo', onlineSince: '2026-10-29T08:00:00Z' }),
      ],
      cfg,
    );
    expect(r.chosen?.driverId).toBe('antigo');
  });

  it('descarta e conta cada motivo', () => {
    const r = chooseCandidate(
      [
        cand({ driverId: '1', distanceMeters: cfg.radiusMeters + 1 }),
        cand({ driverId: '2', positionAgeSeconds: cfg.maxPositionAgeSeconds + 1 }),
        cand({ driverId: '3', approved: false }),
        cand({ driverId: '4', busy: true }),
        cand({ driverId: '5', alreadyTried: true }),
        cand({ driverId: '6' }),
      ],
      cfg,
    );
    expect(r.chosen?.driverId).toBe('6');
    expect(r.excluded).toEqual({
      FORA_DO_RAIO: 1,
      POSICAO_ANTIGA: 1,
      NAO_APROVADO: 1,
      OCUPADO: 1,
      JA_TENTADO: 1,
    });
  });

  it('raio e idade são limites inclusivos', () => {
    const r = chooseCandidate(
      [
        cand({
          driverId: 'x',
          distanceMeters: cfg.radiusMeters,
          positionAgeSeconds: cfg.maxPositionAgeSeconds,
        }),
      ],
      cfg,
    );
    expect(r.chosen?.driverId).toBe('x');
  });

  it('sem candidatos', () => {
    expect(chooseCandidate([], cfg)).toEqual({ chosen: null, excluded: {}, eligible: 0 });
  });

  it('recusar não pune: o resultado não depende de histórico de recusas', () => {
    // O candidato não carrega nenhuma contagem de recusas; só "já tentado" NESTE pedido.
    const a = cand({ driverId: 'a', distanceMeters: 100 });
    expect(chooseCandidate([a, cand({ driverId: 'b' })], cfg).chosen?.driverId).toBe('a');
  });
});

describe('validateDispatchConfig', () => {
  it('padrão é válido', () => expect(validateDispatchConfig(cfg)).toEqual([]));
  it('rejeita fora dos limites e não inteiros', () => {
    expect(validateDispatchConfig({ ...cfg, radiusMeters: 10 })).toHaveLength(1);
    expect(validateDispatchConfig({ ...cfg, offerTtlSeconds: 2.5 })).toHaveLength(1);
    expect(validateDispatchConfig({ ...cfg, offerTtlSeconds: 100, maxSearchSeconds: 60 })).toEqual([
      'offerTtlSeconds não pode ser maior que maxSearchSeconds',
    ]);
  });
});

describe('geo', () => {
  it('haversine: ~1,1 km por 0,01° de latitude', () => {
    const d = haversineMeters({ lat: -7.115, lng: -34.86 }, { lat: -7.105, lng: -34.86 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
    expect(haversineMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });
  it('isValidPoint', () => {
    expect(isValidPoint({ lat: -7.1, lng: -34.8 })).toBe(true);
    expect(isValidPoint({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidPoint({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidPoint({ lat: '1', lng: 0 })).toBe(false);
    expect(isValidPoint({ lat: NaN, lng: 0 })).toBe(false);
    expect(isValidPoint(null)).toBe(false);
  });
});
