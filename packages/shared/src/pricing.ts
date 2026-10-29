import { assertCents, type Cents } from './money';

export interface FloorRates {
  /** Piso por km, em centavos. Valor definido pela associação (config), não fixo no código. */
  perKmCents: Cents;
  /** Piso por minuto, em centavos. */
  perMinuteCents: Cents;
}

/**
 * Valor mínimo de uma corrida/entrega. Distância em metros e tempo em segundos
 * (inteiros) para evitar float; arredonda para cima ao centavo, em favor do trabalhador.
 */
export function minimumFare(
  distanceMeters: number,
  durationSeconds: number,
  rates: FloorRates,
): Cents {
  assertCents(distanceMeters, 'distanceMeters');
  assertCents(durationSeconds, 'durationSeconds');
  assertCents(rates.perKmCents, 'perKmCents');
  assertCents(rates.perMinuteCents, 'perMinuteCents');
  // (m * c/km / 1000) + (s * c/min / 60), com denominador comum 60000.
  const numerator =
    distanceMeters * rates.perKmCents * 60 + durationSeconds * rates.perMinuteCents * 1000;
  return Math.ceil(numerator / 60000);
}

/** Nunca cobra abaixo do piso. */
export function applyFloor(proposedCents: Cents, floorCents: Cents): Cents {
  assertCents(proposedCents, 'proposedCents');
  assertCents(floorCents, 'floorCents');
  return Math.max(proposedCents, floorCents);
}
