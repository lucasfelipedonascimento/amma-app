/**
 * Avaliação depois de entregue: 1 a 5 estrelas. O cliente avalia o motorista (entregas e corridas) e,
 * nas corridas, o motorista também avalia o passageiro (avaliação mútua). Uma por direção.
 */
export const RATING_DIRECTIONS = ['CLIENTE_AVALIA_MOTORISTA', 'MOTORISTA_AVALIA_CLIENTE'] as const;
export type RatingDirection = (typeof RATING_DIRECTIONS)[number];
export const RATING_STARS = [1, 2, 3, 4, 5] as const;
export type RatingStars = (typeof RATING_STARS)[number];
export const RATING_COMMENT_MAX = 280;

export const isValidStars = (n: unknown): n is RatingStars =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;

/** Média com uma casa decimal (arredondada para baixo: na dúvida, não inflar a nota). null se não há notas. */
export function averageStars(stars: readonly number[]): number | null {
  if (stars.length === 0) return null;
  const sum = stars.reduce((a, b) => a + b, 0);
  return Math.floor((sum * 10) / stars.length) / 10;
}

/** Com poucas notas a média engana: abaixo disso mostramos só a quantidade. */
export const RATING_MIN_COUNT_FOR_AVERAGE = 3;

export interface RatingSummary {
  /** null enquanto houver menos de RATING_MIN_COUNT_FOR_AVERAGE notas. */
  average: number | null;
  count: number;
}

export function ratingSummary(stars: readonly number[]): RatingSummary {
  return {
    average: stars.length >= RATING_MIN_COUNT_FOR_AVERAGE ? averageStars(stars) : null,
    count: stars.length,
  };
}
