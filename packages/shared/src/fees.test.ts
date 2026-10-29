import { describe, expect, it } from 'vitest';
import { calculateRideFees } from './fees';

describe('calculateRideFees', () => {
  it('aplica só a taxa base de 10% sem associação', () => {
    expect(calculateRideFees(2000)).toEqual({
      grossCents: 2000,
      platformFeeCents: 200,
      associationFeeCents: 0,
      workerNetCents: 1800,
    });
  });
  it('soma 2% e 4% de associação', () => {
    expect(calculateRideFees(2000, 2).workerNetCents).toBe(1760);
    expect(calculateRideFees(2000, 4).associationFeeCents).toBe(80);
    expect(calculateRideFees(2000, 4).workerNetCents).toBe(1720);
  });
  it('arredonda taxas para baixo e a soma fecha com o bruto', () => {
    const f = calculateRideFees(1999, 2); // 199,9 -> 199 ; 39,98 -> 39
    expect(f.platformFeeCents).toBe(199);
    expect(f.associationFeeCents).toBe(39);
    expect(f.platformFeeCents + f.associationFeeCents + f.workerNetCents).toBe(1999);
  });
  it('rejeita valores inválidos', () => {
    expect(() => calculateRideFees(10.5)).toThrow();
    expect(() => calculateRideFees(-1)).toThrow();
    expect(() => calculateRideFees(1000, 3 as never)).toThrow();
  });
});
