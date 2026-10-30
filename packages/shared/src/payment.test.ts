import { describe, expect, it } from 'vitest';
import {
  canDispatch,
  canTransitionPayment,
  cardBrand,
  isValidCardCvv,
  isValidCardNumber,
  lastFour,
  maskCardExpiry,
  maskCardNumber,
  parseCardExpiry,
  refundAction,
} from './payment';

describe('estados do pagamento', () => {
  it('só avança pelos caminhos permitidos', () => {
    expect(canTransitionPayment('PENDENTE', 'PAGO')).toBe(true);
    expect(canTransitionPayment('PENDENTE', 'EXPIRADO')).toBe(true);
    expect(canTransitionPayment('PAGO', 'ESTORNADO')).toBe(true);
    expect(canTransitionPayment('PENDENTE', 'ESTORNADO')).toBe(false);
    expect(canTransitionPayment('ESTORNADO', 'PAGO')).toBe(false);
    expect(canTransitionPayment('EXPIRADO', 'PAGO')).toBe(false);
  });
});

describe('refundAction', () => {
  it('cancelado e pago → estorna; cancelado e pendente → expira', () => {
    expect(refundAction('CANCELADO', 'PAGO')).toBe('ESTORNAR');
    expect(refundAction('CANCELADO', 'PENDENTE')).toBe('EXPIRAR');
    expect(refundAction('CANCELADO', 'ESTORNADO')).toBe('NADA');
  });
  it('entregue e pago → só manual', () => {
    expect(refundAction('ENTREGUE', 'PAGO')).toBe('MANUAL');
  });
  it('pedido em andamento não mexe no pagamento', () => {
    expect(refundAction('COLETADO', 'PAGO')).toBe('NADA');
  });
});

describe('canDispatch', () => {
  it('exige pagamento confirmado, exceto pedido sem pagamento', () => {
    expect(canDispatch('PAGO')).toBe(true);
    expect(canDispatch(null)).toBe(true);
    expect(canDispatch('PENDENTE')).toBe(false);
    expect(canDispatch('EXPIRADO')).toBe(false);
  });
});

describe('cartão', () => {
  it('Luhn', () => {
    expect(isValidCardNumber('4242 4242 4242 4242')).toBe(true);
    expect(isValidCardNumber('5555555555554444')).toBe(true);
    expect(isValidCardNumber('4242 4242 4242 4241')).toBe(false);
    expect(isValidCardNumber('1234')).toBe(false);
    expect(isValidCardNumber('')).toBe(false);
  });
  it('bandeira', () => {
    expect(cardBrand('4242424242424242')).toBe('visa');
    expect(cardBrand('5555555555554444')).toBe('mastercard');
    expect(cardBrand('378282246310005')).toBe('amex');
    expect(cardBrand('6362970000457013')).toBe('elo');
    expect(cardBrand('9999')).toBe('outra');
  });
  it('máscaras aceitam digitação parcial', () => {
    expect(maskCardNumber('42424')).toBe('4242 4');
    expect(maskCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(maskCardExpiry('1')).toBe('1');
    expect(maskCardExpiry('122')).toBe('12/2');
    expect(maskCardExpiry('1229')).toBe('12/29');
  });
  it('validade vale até o fim do mês', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    expect(parseCardExpiry('10/26', now)).toEqual({ month: 10, year: 2026 });
    expect(parseCardExpiry('09/26', now)).toBeNull();
    expect(parseCardExpiry('13/30', now)).toBeNull();
    expect(parseCardExpiry('1/30', now)).toBeNull();
  });
  it('cvv: 3 dígitos (4 na Amex)', () => {
    expect(isValidCardCvv('123')).toBe(true);
    expect(isValidCardCvv('12')).toBe(false);
    expect(isValidCardCvv('1234', 'amex')).toBe(true);
    expect(isValidCardCvv('123', 'amex')).toBe(false);
  });
  it('lastFour', () => expect(lastFour('4242 4242 4242 4242')).toBe('4242'));
});
