import { randomInt } from 'node:crypto';
import { hmac, safeEqual } from '../common/crypto';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** No máximo 3 códigos por telefone a cada 10 minutos. */
export const OTP_MAX_REQUESTS = 3;
export const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
/** Teto diário de SMS por telefone (custo e abuso). */
export const OTP_MAX_REQUESTS_PER_DAY = 10;
/** Erros de código por telefone em 1 hora, somando todos os códigos (trava o chute de 6 dígitos). */
export const OTP_MAX_FAILED_PER_HOUR = 20;

export const generateOtpCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** O hash inclui o telefone: o mesmo código não vale para outro número. */
export const hashOtp = (secret: string, phone: string, code: string): string =>
  hmac(secret, `${phone}:${code}`);

export interface OtpRecord {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type OtpVerdict = 'OK' | 'EXPIRED' | 'USED' | 'TOO_MANY_ATTEMPTS' | 'INVALID';

/** Decide se o código informado vale. Pura (sem banco), por isso é fácil de testar. */
export function evaluateOtp(record: OtpRecord, candidateHash: string, now: Date): OtpVerdict {
  if (record.consumedAt) return 'USED';
  if (record.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (record.attempts >= OTP_MAX_ATTEMPTS) return 'TOO_MANY_ATTEMPTS';
  return safeEqual(record.codeHash, candidateHash) ? 'OK' : 'INVALID';
}
