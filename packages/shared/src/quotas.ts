import { assertCents, type Cents } from './money';

/** 1 cota = R$ 5,00. Cotas são registros contábeis, não dinheiro em custódia. */
export const QUOTA_VALUE_CENTS = 500;

export type Level = 'BRONZE' | 'SILVER' | 'GOLD';

export interface QuotaBalance {
  quotas: number;
  /** Fração de cota ainda não completada (0 a 499 centavos). */
  remainderCents: Cents;
}

/**
 * Soma uma taxa de associação ao saldo. O que não completa uma cota
 * fica em remainderCents e é aproveitado nas próximas corridas.
 */
export function addAssociationFee(balance: QuotaBalance, feeCents: Cents): QuotaBalance {
  assertCents(feeCents, 'feeCents');
  assertCents(balance.remainderCents, 'remainderCents');
  const total = balance.remainderCents + feeCents;
  return {
    quotas: balance.quotas + Math.floor(total / QUOTA_VALUE_CENTS),
    remainderCents: total % QUOTA_VALUE_CENTS,
  };
}

/** Bronze 0-29, Prata 30-59, Ouro 60+. */
export function levelForQuotas(quotas: number): Level {
  if (!Number.isInteger(quotas) || quotas < 0)
    throw new Error('quotas deve ser inteiro não negativo');
  if (quotas >= 60) return 'GOLD';
  if (quotas >= 30) return 'SILVER';
  return 'BRONZE';
}
