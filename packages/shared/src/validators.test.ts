import { describe, expect, it } from 'vitest';
import {
  isValidCpf,
  isValidVehicleYear,
  maskCpf,
  maskDate,
  maskPlate,
  normalizeBrazilPhone,
  normalizePlate,
  parseBrDate,
} from './validators';

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

describe('máscaras', () => {
  it('maskDate: 19092001 → 19/09/2001, também parcial e com lixo', () => {
    expect(maskDate('19092001')).toBe('19/09/2001');
    expect(maskDate('1')).toBe('1');
    expect(maskDate('190')).toBe('19/0');
    expect(maskDate('1909')).toBe('19/09');
    expect(maskDate('19/09/2001')).toBe('19/09/2001');
    expect(maskDate('190920012345')).toBe('19/09/2001');
  });
  it('maskCpf', () => {
    expect(maskCpf('52998224725')).toBe('529.982.247-25');
    expect(maskCpf('5299')).toBe('529.9');
    expect(maskCpf('529982247')).toBe('529.982.247');
    expect(maskCpf('529.982.247-25999')).toBe('529.982.247-25');
  });
  it('maskPlate: maiúsculas, sem símbolos, máx. 7', () => {
    expect(maskPlate('abc1d23')).toBe('ABC1D23');
    expect(maskPlate('abc-1234')).toBe('ABC1234');
    expect(maskPlate('ABC1D23XYZ')).toBe('ABC1D23');
  });
  it('máscaras produzem entradas aceitas pelos validadores', () => {
    expect(isValidCpf(maskCpf('52998224725'))).toBe(true);
    expect(normalizePlate(maskPlate('abc1d23'))).toBe('ABC1D23');
  });
});

describe('parseBrDate', () => {
  it('converte para ISO', () => expect(parseBrDate('19/09/2001')).toBe('2001-09-19'));
  it.each(['19092001', '31/02/2001', '00/01/2001', '10/13/2001', '19/09/1800', ''])(
    'rejeita %s',
    (v) => expect(parseBrDate(v)).toBeNull(),
  );
  it('aceita 29/02 em ano bissexto e rejeita fora dele', () => {
    expect(parseBrDate('29/02/2000')).toBe('2000-02-29');
    expect(parseBrDate('29/02/2001')).toBeNull();
  });
});
