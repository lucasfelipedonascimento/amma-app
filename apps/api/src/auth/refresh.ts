export const ACCESS_TTL = '15m';
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RefreshRecord {
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * REUSED = token já usado/revogado sendo apresentado de novo: sinal de roubo,
 * então o serviço revoga TODAS as sessões do usuário.
 */
export type RefreshVerdict = 'OK' | 'EXPIRED' | 'REUSED';

export function evaluateRefresh(record: RefreshRecord, now: Date): RefreshVerdict {
  if (record.revokedAt) return 'REUSED';
  if (record.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'OK';
}
