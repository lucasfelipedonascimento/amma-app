import { describe, expect, it } from 'vitest';
import { assertJwtSecret, jwtOptions } from './jwt-config';

describe('segredo do JWT', () => {
  it('sem segredo, não sobe', () => {
    expect(() => assertJwtSecret(undefined, 'development')).toThrow();
  });
  it('em desenvolvimento aceita segredo curto', () => {
    expect(assertJwtSecret('curto', 'development')).toBe('curto');
  });
  it('em produção exige 32+ caracteres e recusa valores de exemplo', () => {
    expect(() => assertJwtSecret('curto', 'production')).toThrow(/32/);
    expect(() => assertJwtSecret('segredo-de-teste-' + 'x'.repeat(30), 'production')).toThrow(
      /exemplo/,
    );
    expect(assertJwtSecret('a'.repeat(32), 'production')).toHaveLength(32);
  });
  it('fixa algoritmo, emissor e audiência na assinatura e na verificação', () => {
    const o = jwtOptions('s');
    expect(o.verifyOptions?.algorithms).toEqual(['HS256']);
    expect(o.verifyOptions?.issuer).toBe(o.signOptions?.issuer);
    expect(o.verifyOptions?.audience).toBe(o.signOptions?.audience);
  });
});
