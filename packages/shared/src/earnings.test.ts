import { describe, expect, it } from 'vitest';
import {
  businessDay,
  compareWithCompetitor,
  lastBusinessDays,
  offerBreakdown,
  simulateEarnings,
  sumDeliveries,
  weekByDay,
  type SettledDelivery,
} from './earnings';

const delivery = (deliveredAt: string, fareCents = 1100): SettledDelivery => ({
  deliveredAt,
  fareCents,
  platformFeeCents: Math.floor(fareCents / 10),
  associationFeeCents: 0,
  workerNetCents: fareCents - Math.floor(fareCents / 10),
});

describe('compareWithCompetitor', () => {
  it('R$ 100,00: concorrente deixa R$ 75,00; AMMA a 0% deixa R$ 90,00', () => {
    expect(compareWithCompetitor(10_000, 9_000)).toEqual({
      competitorFeeCents: 2_500,
      competitorNetCents: 7_500,
      extraCents: 1_500,
    });
  });

  it('arredonda a taxa do concorrente para cima (não exagera a vantagem)', () => {
    // 25% de R$ 11,00 = 275 → 275; de R$ 10,01 = 250,25 → 251
    expect(compareWithCompetitor(1_001, 901).competitorFeeCents).toBe(251);
  });

  it('a vantagem nunca é negativa', () => {
    expect(compareWithCompetitor(1_000, 100).extraCents).toBe(0);
  });
});

describe('dias no fuso de João Pessoa (UTC−3)', () => {
  it('01:00 UTC ainda é o dia anterior em João Pessoa', () => {
    expect(businessDay('2026-10-30T01:00:00Z')).toBe('2026-10-29');
    expect(businessDay('2026-10-30T03:00:00Z')).toBe('2026-10-30');
  });

  it('lista os últimos 7 dias, o mais antigo primeiro', () => {
    const days = lastBusinessDays(new Date('2026-10-29T15:00:00Z'), 7);
    expect(days[0]).toBe('2026-10-23');
    expect(days[6]).toBe('2026-10-29');
    expect(days).toHaveLength(7);
  });

  it('rejeita data inválida', () => {
    expect(() => businessDay('ontem')).toThrow();
  });
});

describe('totais', () => {
  it('soma entregas e deixa dias vazios zerados', () => {
    const now = new Date('2026-10-29T15:00:00Z');
    const list = [
      delivery('2026-10-29T12:00:00Z'),
      delivery('2026-10-29T14:00:00Z', 2000),
      delivery('2026-10-27T12:00:00Z'),
    ];
    const week = weekByDay(list, now);
    expect(week.find((d) => d.date === '2026-10-29')).toMatchObject({
      deliveries: 2,
      grossCents: 3100,
      netCents: 990 + 1800,
    });
    expect(week.find((d) => d.date === '2026-10-28')).toMatchObject({ deliveries: 0, netCents: 0 });
    expect(sumDeliveries(list).deliveries).toBe(3);
  });
});

describe('simulateEarnings', () => {
  it('R$ 11,00 a 2%: líquido R$ 9,68 e concorrente R$ 8,25', () => {
    const r = simulateEarnings(1_100, 2);
    expect(r.workerNetCents).toBe(968);
    expect(r.competitorNetCents).toBe(825);
    expect(r.extraCents).toBe(143);
  });
});

describe('offerBreakdown', () => {
  it('R$ 11,00 com líquido R$ 9,68: taxa base 1,10 e associação 0,22 (2%)', () => {
    expect(offerBreakdown(1_100, 968)).toEqual({
      grossCents: 1_100,
      platformFeeCents: 110,
      associationFeeCents: 22,
      netCents: 968,
      associationRate: 2,
    });
  });

  it('sem taxa de associação', () => {
    expect(offerBreakdown(1_100, 990)).toMatchObject({
      associationFeeCents: 0,
      associationRate: 0,
    });
  });

  it('líquido que não bate com 0/2/4 não inventa a taxa', () => {
    expect(offerBreakdown(1_100, 950).associationRate).toBeNull();
  });
});
