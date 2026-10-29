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

describe('calculateRideFees — casos de borda', () => {
  it('R$ 11,00 com 2% => trabalhador R$ 9,68', () => {
    const f = calculateRideFees(1100, 2);
    expect(f.platformFeeCents).toBe(110);
    expect(f.associationFeeCents).toBe(22);
    expect(f.workerNetCents).toBe(968);
  });
  it('corrida de 1 centavo: taxas arredondam para 0 e o trabalhador fica com tudo', () => {
    expect(calculateRideFees(1, 4)).toEqual({
      grossCents: 1,
      platformFeeCents: 0,
      associationFeeCents: 0,
      workerNetCents: 1,
    });
  });
  it('corrida zerada é permitida e tudo é zero', () => {
    expect(calculateRideFees(0, 4).workerNetCents).toBe(0);
  });
  it('valores grandes não perdem precisão', () => {
    const f = calculateRideFees(99_999_999, 4);
    expect(f.platformFeeCents + f.associationFeeCents + f.workerNetCents).toBe(99_999_999);
  });
  it('a soma sempre fecha com o bruto (varredura)', () => {
    for (let g = 0; g <= 2000; g += 7)
      for (const r of [0, 2, 4] as const) {
        const f = calculateRideFees(g, r);
        expect(f.platformFeeCents + f.associationFeeCents + f.workerNetCents).toBe(g);
        expect(f.workerNetCents).toBeGreaterThanOrEqual(0);
      }
  });
});
