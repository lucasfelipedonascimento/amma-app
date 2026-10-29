import { assertCents, type Cents } from './money';

/** Taxa base da plataforma: 10% de cada corrida. */
export const BASE_FEE_PERCENT = 10;

/** Taxas de associação permitidas (opcional; vira cotas do trabalhador). */
export const ASSOCIATION_RATES = [0, 2, 4] as const;
export type AssociationRate = (typeof ASSOCIATION_RATES)[number];

export interface RideFees {
  grossCents: Cents;
  platformFeeCents: Cents;
  associationFeeCents: Cents;
  /** O que o trabalhador recebe: bruto - taxa base - taxa de associação. */
  workerNetCents: Cents;
}

// Arredonda PARA BAIXO: o centavo quebrado nunca é descontado do trabalhador.
const percentOf = (cents: Cents, percent: number): Cents => Math.floor((cents * percent) / 100);

export function calculateRideFees(
  grossCents: Cents,
  associationRate: AssociationRate = 0,
): RideFees {
  assertCents(grossCents, 'grossCents');
  if (!ASSOCIATION_RATES.includes(associationRate)) {
    throw new Error('Taxa de associação deve ser 0, 2 ou 4');
  }
  const platformFeeCents = percentOf(grossCents, BASE_FEE_PERCENT);
  const associationFeeCents = percentOf(grossCents, associationRate);
  return {
    grossCents,
    platformFeeCents,
    associationFeeCents,
    workerNetCents: grossCents - platformFeeCents - associationFeeCents,
  };
}
