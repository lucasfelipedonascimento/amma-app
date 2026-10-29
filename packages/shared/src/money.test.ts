import { describe, expect, it } from 'vitest';
import { formatBRL } from './money';

describe('formatBRL', () => {
  it('formata centavos em reais', () => {
    expect(formatBRL(1250).replace(/\s/g, ' ')).toBe('R$ 12,50');
  });
  it('rejeita valores não inteiros', () => {
    expect(() => formatBRL(10.5)).toThrow();
  });
});
