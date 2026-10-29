import { describe, expect, it } from 'vitest';
import { OTP_MAX_ATTEMPTS, evaluateOtp, generateOtpCode, hashOtp } from './otp';

const now = new Date('2026-10-29T12:00:00Z');
const rec = (over = {}) => ({
  codeHash: hashOtp('s', '+5583999991234', '123456'),
  expiresAt: new Date(now.getTime() + 60_000),
  attempts: 0,
  consumedAt: null,
  ...over,
});
const good = hashOtp('s', '+5583999991234', '123456');

describe('OTP', () => {
  it('gera 6 dígitos (com zeros à esquerda)', () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
  it('hash depende do telefone e do segredo', () => {
    expect(hashOtp('s', '+5583999991234', '123456')).not.toBe(
      hashOtp('s', '+5583999995678', '123456'),
    );
    expect(hashOtp('s', '+5583999991234', '123456')).not.toBe(
      hashOtp('outro', '+5583999991234', '123456'),
    );
  });
  it('aceita código correto dentro do prazo', () => {
    expect(evaluateOtp(rec(), good, now)).toBe('OK');
  });
  it('rejeita código errado', () => {
    expect(evaluateOtp(rec(), hashOtp('s', '+5583999991234', '000000'), now)).toBe('INVALID');
  });
  it('rejeita expirado, inclusive no instante exato', () => {
    expect(evaluateOtp(rec({ expiresAt: new Date(now.getTime() - 1) }), good, now)).toBe('EXPIRED');
    expect(evaluateOtp(rec({ expiresAt: now }), good, now)).toBe('EXPIRED');
  });
  it('rejeita código já usado (uso único)', () => {
    expect(evaluateOtp(rec({ consumedAt: now }), good, now)).toBe('USED');
  });
  it('bloqueia após o máximo de tentativas, mesmo com o código certo', () => {
    expect(evaluateOtp(rec({ attempts: OTP_MAX_ATTEMPTS }), good, now)).toBe('TOO_MANY_ATTEMPTS');
  });
});
