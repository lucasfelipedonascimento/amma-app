import { describe, expect, it } from 'vitest';
import { addAssociationFee, levelForQuotas } from './quotas';

describe('addAssociationFee', () => {
  it('converte R$ 5 em 1 cota', () => {
    expect(addAssociationFee({ quotas: 0, remainderCents: 0 }, 500)).toEqual({
      quotas: 1,
      remainderCents: 0,
    });
  });
  it('guarda o resto para a próxima corrida', () => {
    const a = addAssociationFee({ quotas: 2, remainderCents: 0 }, 320);
    expect(a).toEqual({ quotas: 2, remainderCents: 320 });
    expect(addAssociationFee(a, 320)).toEqual({ quotas: 3, remainderCents: 140 });
  });
  it('converte várias cotas de uma vez', () => {
    expect(addAssociationFee({ quotas: 0, remainderCents: 499 }, 1501)).toEqual({
      quotas: 4,
      remainderCents: 0,
    });
  });
});

describe('levelForQuotas', () => {
  it.each([
    [0, 'BRONZE'],
    [29, 'BRONZE'],
    [30, 'SILVER'],
    [59, 'SILVER'],
    [60, 'GOLD'],
    [200, 'GOLD'],
  ])('%i cotas -> %s', (q, level) => expect(levelForQuotas(q)).toBe(level));
  it('rejeita valores inválidos', () => {
    expect(() => levelForQuotas(-1)).toThrow();
    expect(() => levelForQuotas(1.5)).toThrow();
  });
});
