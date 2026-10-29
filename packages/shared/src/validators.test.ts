import { describe, expect, it } from 'vitest';
import { isValidCpf, isValidVehicleYear, normalizeBrazilPhone, normalizePlate } from './validators';

describe('normalizeBrazilPhone', () => {
  it.each([
    ['(83) 99999-1234', '+5583999991234'],
    ['83999991234', '+5583999991234'],
    ['+55 83 99999-1234', '+5583999991234'],
    ['5583999991234', '+5583999991234'],
  ])('%s -> %s', (i, o) => expect(normalizeBrazilPhone(i)).toBe(o));
  it.each(['', '123', '8333334444', '(83) 89999-1234', '(05) 99999-1234', '+1 202 555 0100'])(
    'rejeita %s',
    (i) => expect(normalizeBrazilPhone(i)).toBeNull(),
  );
});

describe('isValidCpf', () => {
  it('aceita CPF válido (com e sem máscara)', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });
  it('rejeita dígito errado, repetidos e tamanho errado', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
});

describe('normalizePlate', () => {
  it('aceita antiga e Mercosul, normaliza', () => {
    expect(normalizePlate('abc-1234')).toBe('ABC1234');
    expect(normalizePlate('bra1d23')).toBe('BRA1D23');
  });
  it('rejeita formatos inválidos', () => {
    expect(normalizePlate('AB12345')).toBeNull();
    expect(normalizePlate('ABCD123')).toBeNull();
  });
});

describe('isValidVehicleYear', () => {
  const now = new Date('2026-10-29T00:00:00Z');
  it('limites', () => {
    expect(isValidVehicleYear(1980, now)).toBe(true);
    expect(isValidVehicleYear(2027, now)).toBe(true);
    expect(isValidVehicleYear(2028, now)).toBe(false);
    expect(isValidVehicleYear(1979, now)).toBe(false);
    expect(isValidVehicleYear(2020.5, now)).toBe(false);
  });
});
