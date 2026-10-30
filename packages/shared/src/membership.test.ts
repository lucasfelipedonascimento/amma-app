import { describe, expect, it } from 'vitest';
import { isMember, levelProgress } from './membership';

describe('isMember', () => {
  it('sócio é quem tem ao menos 1 cota', () => {
    expect(isMember(0)).toBe(false);
    expect(isMember(1)).toBe(true);
  });
});

describe('levelProgress', () => {
  it('Bronze sem cota: faltam 30 cotas para a Prata', () => {
    expect(levelProgress({ quotas: 0, remainderCents: 0 })).toEqual({
      level: 'BRONZE',
      nextLevel: 'SILVER',
      quotasToNext: 30,
      centsToNext: 15_000,
      percent: 0,
    });
  });
  it('desconta a fração de cota já acumulada', () => {
    const p = levelProgress({ quotas: 15, remainderCents: 320 });
    expect(p.quotasToNext).toBe(15);
    expect(p.centsToNext).toBe(15 * 500 - 320);
    expect(p.percent).toBe(50);
  });
  it('29 cotas: falta 1 e o percentual não chega a 100', () => {
    const p = levelProgress({ quotas: 29, remainderCents: 0 });
    expect(p).toMatchObject({ level: 'BRONZE', quotasToNext: 1, percent: 96 });
  });
  it('30 cotas: vira Prata e a barra recomeça', () => {
    expect(levelProgress({ quotas: 30, remainderCents: 0 })).toMatchObject({
      level: 'SILVER',
      nextLevel: 'GOLD',
      quotasToNext: 30,
      percent: 0,
    });
  });
  it('Ouro não tem próximo nível', () => {
    expect(levelProgress({ quotas: 60, remainderCents: 0 })).toEqual({
      level: 'GOLD',
      nextLevel: null,
      quotasToNext: null,
      centsToNext: null,
      percent: 100,
    });
  });
});
