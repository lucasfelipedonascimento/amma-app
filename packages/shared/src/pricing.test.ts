import { describe, expect, it } from 'vitest';
import { calculateFare, selectPricingConfig, type PricingConfig } from './pricing';

// Valores só para teste (os reais são configuração da associação).
const v1: PricingConfig = {
  version: 'v1',
  effectiveFrom: '2026-01-01T00:00:00Z',
  baseCents: 300,
  perKmCents: 200,
  perMinuteCents: 60,
  minimumFareCents: 800,
};
const v2: PricingConfig = {
  ...v1,
  version: 'v2',
  effectiveFrom: '2026-06-01T00:00:00Z',
  perKmCents: 250,
};

describe('calculateFare', () => {
  it('soma base + km + minutos', () => {
    // 5 km = 1000 ; 10 min = 600 ; base 300
    expect(calculateFare(5000, 600, v1)).toEqual({
      fareCents: 1900,
      calculatedCents: 1900,
      minimumApplied: false,
      configVersion: 'v1',
    });
  });
  it('aplica o piso quando o cálculo fica abaixo', () => {
    const r = calculateFare(500, 60, v1); // 100 + 60 + 300 = 460 < 800
    expect(r.fareCents).toBe(800);
    expect(r.calculatedCents).toBe(460);
    expect(r.minimumApplied).toBe(true);
  });
  it('no limite exato do piso não marca piso aplicado', () => {
    // 300 + 500 = 800 -> 2500 m = 500 c, 0 s
    const r = calculateFare(2500, 0, v1);
    expect(r.fareCents).toBe(800);
    expect(r.minimumApplied).toBe(false);
  });
  it('arredonda a parte variável para cima ao centavo', () => {
    const r = calculateFare(1, 0, { ...v1, baseCents: 0, minimumFareCents: 0 }); // 0,2 -> 1
    expect(r.fareCents).toBe(1);
  });
  it('corrida zerada cobra o piso', () => {
    expect(calculateFare(0, 0, v1).fareCents).toBe(800);
  });
  it('rejeita valores inválidos', () => {
    expect(() => calculateFare(-1, 0, v1)).toThrow();
    expect(() => calculateFare(1.5, 0, v1)).toThrow();
    expect(() => calculateFare(0, 0, { ...v1, perKmCents: 1.5 })).toThrow();
  });
});

describe('selectPricingConfig', () => {
  const all = [v2, v1]; // fora de ordem de propósito
  it('usa a versão vigente na data', () => {
    expect(selectPricingConfig(all, new Date('2026-03-01T00:00:00Z')).version).toBe('v1');
    expect(selectPricingConfig(all, new Date('2026-06-01T00:00:00Z')).version).toBe('v2');
    expect(selectPricingConfig(all, new Date('2027-01-01T00:00:00Z')).version).toBe('v2');
  });
  it('falha se nenhuma versão está vigente', () => {
    expect(() => selectPricingConfig(all, new Date('2025-01-01T00:00:00Z'))).toThrow();
  });
});
