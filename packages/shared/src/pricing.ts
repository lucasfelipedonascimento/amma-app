import { assertCents, type Cents } from './money';

/**
 * Tabela de preço VERSIONADA. Cada alteração de valores vira uma nova versão com
 * `effectiveFrom`; versões antigas nunca são editadas (corridas já feitas continuam
 * explicáveis pela versão que usaram). Os valores reais são definidos pela associação
 * (configuração), não ficam fixos no código.
 */
export interface PricingConfig {
  /** Identificador da versão, ex.: "2026-11-01". */
  version: string;
  /** Início da vigência, ISO 8601 em UTC. */
  effectiveFrom: string;
  /** Valor fixo de cada corrida (bandeirada). */
  baseCents: Cents;
  perKmCents: Cents;
  perMinuteCents: Cents;
  /** Piso: a corrida nunca custa menos que isso. */
  minimumFareCents: Cents;
}

export interface FareResult {
  /** Valor final cobrado (já com o piso). */
  fareCents: Cents;
  /** Valor antes do piso: base + km + minutos. */
  calculatedCents: Cents;
  minimumApplied: boolean;
  /** Versão da tabela usada (guardar na corrida para auditoria). */
  configVersion: string;
}

/** Escolhe a versão vigente em `at`: a mais recente com effectiveFrom <= at. */
export function selectPricingConfig(configs: readonly PricingConfig[], at: Date): PricingConfig {
  const valid = configs
    .filter((c) => Date.parse(c.effectiveFrom) <= at.getTime())
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
  if (valid.length === 0) throw new Error('Nenhuma tabela de preço vigente na data informada');
  return valid[0];
}

/**
 * fare = max( base + km*perKm + min*perMinute , piso )
 * Distância em metros e tempo em segundos (inteiros, sem float). A parte variável é
 * arredondada PARA CIMA ao centavo (em favor do trabalhador).
 */
export function calculateFare(
  distanceMeters: number,
  durationSeconds: number,
  config: PricingConfig,
): FareResult {
  assertCents(distanceMeters, 'distanceMeters');
  assertCents(durationSeconds, 'durationSeconds');
  for (const key of ['baseCents', 'perKmCents', 'perMinuteCents', 'minimumFareCents'] as const) {
    assertCents(config[key], key);
  }
  // (m * c/km / 1000) + (s * c/min / 60), com denominador comum 60000.
  const variable = Math.ceil(
    (distanceMeters * config.perKmCents * 60 + durationSeconds * config.perMinuteCents * 1000) /
      60000,
  );
  const calculatedCents = config.baseCents + variable;
  const minimumApplied = calculatedCents < config.minimumFareCents;
  return {
    fareCents: minimumApplied ? config.minimumFareCents : calculatedCents,
    calculatedCents,
    minimumApplied,
    configVersion: config.version,
  };
}
