import { describe, expect, it } from 'vitest';
import { averageStars, isValidStars } from './rating';

describe('avaliação', () => {
  it('aceita só inteiros de 1 a 5', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(isValidStars(n)).toBe(true);
    for (const n of [0, 6, 2.5, '3', null, NaN]) expect(isValidStars(n)).toBe(false);
  });
  it('média arredonda para baixo', () => {
    expect(averageStars([])).toBeNull();
    expect(averageStars([5, 5, 4])).toBe(4.6); // 4,666…
    expect(averageStars([5])).toBe(5);
  });
});
