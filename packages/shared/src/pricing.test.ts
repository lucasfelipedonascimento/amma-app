import { describe, expect, it } from 'vitest';
import { applyFloor, minimumFare } from './pricing';

// Taxas só para teste (valores reais são configuração da associação).
const rates = { perKmCents: 200, perMinuteCents: 60 };

describe('minimumFare', () => {
  it('soma distância e tempo', () => {
    expect(minimumFare(5000, 600, rates)).toBe(1000 + 600); // 5 km + 10 min
  });
  it('arredonda para cima ao centavo', () => {
    expect(minimumFare(1, 0, rates)).toBe(1); // 0,2 -> 1
  });
  it('é zero sem distância e tempo', () => {
    expect(minimumFare(0, 0, rates)).toBe(0);
  });
});

describe('applyFloor', () => {
  it('eleva ao piso quando o valor é menor', () => expect(applyFloor(800, 1000)).toBe(1000));
  it('mantém o valor quando já está acima', () => expect(applyFloor(1500, 1000)).toBe(1500));
});
