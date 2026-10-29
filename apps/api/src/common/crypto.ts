import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const hmac = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');
export const randomToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');

/** Comparação em tempo constante (evita ataque por tempo). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
