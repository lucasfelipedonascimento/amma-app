import { describe, expect, it } from 'vitest';
import { businessYearRange, calculateSurplus, isYearOver, type SurplusMember } from './surplus';

const m = (userId: string, quotas: number, useCents: number): SurplusMember => ({
  userId,
  quotas,
  useCents,
});
const amounts = (r: ReturnType<typeof calculateSurplus>) =>
  Object.fromEntries(r.shares.map((s) => [s.userId, s.amountCents]));

describe('calculateSurplus', () => {
  it('só por cotas (uso 0%): proporcional às cotas', () => {
    const r = calculateSurplus([m('a', 10, 1000), m('b', 30, 9000)], {
      distributableCents: 100_00,
      useWeightPercent: 0,
    });
    expect(amounts(r)).toEqual({ a: 25_00, b: 75_00 });
  });
  it('só por uso (uso 100%): proporcional ao uso', () => {
    const r = calculateSurplus([m('a', 10, 1000), m('b', 30, 9000)], {
      distributableCents: 100_00,
      useWeightPercent: 100,
    });
    expect(amounts(r)).toEqual({ a: 10_00, b: 90_00 });
  });
  it('50/50 mistura as duas proporções', () => {
    const r = calculateSurplus([m('a', 10, 1000), m('b', 30, 9000)], {
      distributableCents: 100_00,
      useWeightPercent: 50,
    });
    expect(amounts(r)).toEqual({ a: 17_50, b: 82_50 }); // (25+10)/2 e (75+90)/2
  });
  it('a soma das partes é sempre o total, mesmo com centavos quebrados', () => {
    const members = [m('a', 1, 333), m('b', 1, 333), m('c', 1, 334)];
    for (const total of [1, 2, 99, 100, 1001, 123_457]) {
      const r = calculateSurplus(members, { distributableCents: total, useWeightPercent: 50 });
      expect(r.distributedCents).toBe(total);
      expect(r.shares.reduce((s, x) => s + x.amountCents, 0)).toBe(total);
    }
  });
  it('centavo que sobra vai para o maior resto, empate pelo id (resultado estável)', () => {
    const r = calculateSurplus([m('b', 1, 0), m('a', 1, 0), m('c', 1, 0)], {
      distributableCents: 100,
      useWeightPercent: 0,
    });
    expect(amounts(r)).toEqual({ a: 34, b: 33, c: 33 });
  });
  it('mais cotas e mais uso nunca recebem menos', () => {
    const r = calculateSurplus([m('pouco', 2, 500), m('muito', 20, 5000)], {
      distributableCents: 10_000,
      useWeightPercent: 50,
    });
    expect(amounts(r).muito).toBeGreaterThan(amounts(r).pouco!);
  });
  it('ano sem nenhum uso: divide só pelas cotas, sem dividir por zero', () => {
    const r = calculateSurplus([m('a', 1, 0), m('b', 3, 0)], {
      distributableCents: 400,
      useWeightPercent: 80,
    });
    expect(amounts(r)).toEqual({ a: 100, b: 300 });
  });
  it('quem não é sócio (0 cota) fica de fora, mesmo com uso', () => {
    const r = calculateSurplus([m('socio', 5, 1000), m('visitante', 0, 99_999)], {
      distributableCents: 1000,
      useWeightPercent: 50,
    });
    expect(amounts(r)).toEqual({ socio: 1000 });
    expect(r.totalUseCents).toBe(1000);
    expect(r.memberCount).toBe(1);
  });
  it('valores grandes não perdem precisão', () => {
    const r = calculateSurplus([m('a', 1_000, 9_000_000_000_00), m('b', 3, 1_00)], {
      distributableCents: 5_000_000_000_00,
      useWeightPercent: 50,
    });
    expect(r.distributedCents).toBe(5_000_000_000_00);
  });
  it('é determinístico, independente da ordem da lista', () => {
    const list = [m('a', 3, 70), m('b', 5, 10), m('c', 7, 33)];
    const p = { distributableCents: 9_999, useWeightPercent: 40 };
    expect(calculateSurplus(list, p)).toEqual(calculateSurplus([...list].reverse(), p));
  });
  it('recusa entradas inválidas', () => {
    const ok = [m('a', 1, 1)];
    expect(() => calculateSurplus(ok, { distributableCents: 0, useWeightPercent: 50 })).toThrow();
    expect(() =>
      calculateSurplus(ok, { distributableCents: 10.5, useWeightPercent: 50 }),
    ).toThrow();
    expect(() => calculateSurplus(ok, { distributableCents: 10, useWeightPercent: 101 })).toThrow();
    expect(() => calculateSurplus(ok, { distributableCents: 10, useWeightPercent: -1 })).toThrow();
    expect(() => calculateSurplus([], { distributableCents: 10, useWeightPercent: 50 })).toThrow(
      /sócios/,
    );
    expect(() =>
      calculateSurplus([m('a', 0, 5)], { distributableCents: 10, useWeightPercent: 50 }),
    ).toThrow(/sócios/);
    expect(() =>
      calculateSurplus([m('a', 1, 1), m('a', 2, 2)], {
        distributableCents: 10,
        useWeightPercent: 50,
      }),
    ).toThrow(/repetido/);
  });
});

describe('ano das sobras', () => {
  it('vai de 1º de janeiro 00:00 em João Pessoa (UTC−3) ao 1º do ano seguinte', () => {
    const { start, end } = businessYearRange(2026);
    expect(start.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
  it('só fecha depois de terminar', () => {
    expect(isYearOver(2026, new Date('2027-01-01T02:59:59Z'))).toBe(false);
    expect(isYearOver(2026, new Date('2027-01-01T03:00:00Z'))).toBe(true);
    expect(isYearOver(2025, new Date('2026-10-29T00:00:00Z'))).toBe(true);
  });
  it('ano absurdo', () => {
    expect(() => businessYearRange(26)).toThrow();
    expect(() => businessYearRange(2026.5)).toThrow();
  });
});
