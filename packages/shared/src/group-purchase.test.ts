import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PURCHASE_RULES as R,
  applyRuleChange,
  awardableUnits,
  canJoinQueue,
  queueScore,
  rankQueue,
} from './group-purchase';

const now = new Date('2026-11-30T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe('queueScore', () => {
  it('soma cotas × peso e dias completos × peso', () => {
    expect(queueScore(20, daysAgo(5), now, R)).toBe(20 * 10 + 5);
  });
  it('dia incompleto não conta', () => {
    expect(queueScore(0, new Date(now.getTime() - 86_399_000), now, R)).toBe(0);
  });
  it('entrada no futuro não dá pontos negativos', () => {
    expect(queueScore(1, new Date(now.getTime() + 86_400_000 * 3), now, R)).toBe(10);
  });
});

describe('rankQueue', () => {
  it('ordena por pontos (cotas e tempo)', () => {
    const q = rankQueue(
      [
        { userId: 'a', quotas: 10, joinedAt: daysAgo(1) }, // 101
        { userId: 'b', quotas: 5, joinedAt: daysAgo(80) }, // 130
        { userId: 'c', quotas: 30, joinedAt: daysAgo(0) }, // 300
      ],
      now,
      R,
    );
    expect(q.map((m) => [m.userId, m.position, m.score])).toEqual([
      ['c', 1, 300],
      ['b', 2, 130],
      ['a', 3, 101],
    ]);
  });
  it('empate de pontos: quem entrou antes passa na frente', () => {
    const q = rankQueue(
      [
        { userId: 'novo', quotas: 11, joinedAt: daysAgo(0) }, // 110
        { userId: 'antigo', quotas: 10, joinedAt: daysAgo(10) }, // 110
      ],
      now,
      R,
    );
    expect(q.map((m) => m.userId)).toEqual(['antigo', 'novo']);
  });
  it('empate total: ordem estável por id', () => {
    const j = daysAgo(3);
    const q = rankQueue(
      [
        { userId: 'b', quotas: 4, joinedAt: j },
        { userId: 'a', quotas: 4, joinedAt: j },
      ],
      now,
      R,
    );
    expect(q.map((m) => m.userId)).toEqual(['a', 'b']);
  });
  it('mudar o peso muda a fila (regra configurável)', () => {
    const members = [
      { userId: 'muitas-cotas', quotas: 40, joinedAt: daysAgo(1) },
      { userId: 'veterano', quotas: 2, joinedAt: daysAgo(200) },
    ];
    expect(rankQueue(members, now, R)[0]!.userId).toBe('muitas-cotas'); // 401 x 220
    const soTempo = applyRuleChange(R, { quotaWeight: 1, dayWeight: 5 });
    expect(rankQueue(members, now, soTempo)[0]!.userId).toBe('veterano'); // 45 x 1002
  });
  it('fila vazia', () => {
    expect(rankQueue([], now, R)).toEqual([]);
  });
});

describe('canJoinQueue', () => {
  it('exige o mínimo de cotas da regra, e nunca menos que 1', () => {
    expect(canJoinQueue(0, R)).toBe(false);
    expect(canJoinQueue(1, R)).toBe(true);
    expect(canJoinQueue(9, { ...R, minQuotas: 10 })).toBe(false);
    expect(canJoinQueue(0, { ...R, minQuotas: 0 })).toBe(false);
  });
});

describe('applyRuleChange', () => {
  it('altera só o que foi pedido e não muta o original', () => {
    const next = applyRuleChange(R, { minQuotas: 5 });
    expect(next).toEqual({ ...R, minQuotas: 5 });
    expect(R.minQuotas).toBe(1);
  });
  it.each([
    [{ peso: 1 }, /desconhecida/],
    [{ quotaWeight: -1 }, /peso da cota/],
    [{ quotaWeight: 1.5 }, /peso da cota/],
    [{ quotaWeight: '10' }, /peso da cota/],
    [{ dayWeight: 5000 }, /peso do dia/],
    [{ minContributionCents: 50 }, /aporte mínimo/],
    [{}, /ao menos uma/],
    [[], /objeto/],
    [null, /objeto/],
    [{ quotaWeight: 0, dayWeight: 0 }, /ambos zero/],
  ])('recusa %j', (change, msg) => {
    expect(() => applyRuleChange(R, change)).toThrow(msg);
  });
  it('um peso zero é permitido se o outro não for', () => {
    expect(applyRuleChange(R, { dayWeight: 0 }).dayWeight).toBe(0);
  });
});

describe('awardableUnits', () => {
  it('aportes ÷ valor do veículo, menos os já contemplados', () => {
    expect(awardableUnits(0, 50_000_00, 0)).toBe(0);
    expect(awardableUnits(49_999_99, 50_000_00, 0)).toBe(0);
    expect(awardableUnits(100_000_00, 50_000_00, 0)).toBe(2);
    expect(awardableUnits(100_000_00, 50_000_00, 2)).toBe(0);
    expect(awardableUnits(100_000_00, 50_000_00, 3)).toBe(0);
  });
  it('valor-alvo inválido', () => {
    expect(() => awardableUnits(1, 0, 0)).toThrow();
  });
});
