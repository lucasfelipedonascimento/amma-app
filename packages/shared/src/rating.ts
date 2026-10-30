/** Avaliação do cliente sobre a entrega: 1 a 5 estrelas, uma por pedido, só depois de entregue. */
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
