import { ASSOCIATION_RATES, calculateRideFees, type AssociationRate } from './fees';
import type { Cents } from './money';

/** Taxa de referência de apps concorrentes usada no comparativo mostrado ao motorista. */
export const COMPETITOR_FEE_PERCENT = 25;

/** Fuso de João Pessoa: UTC−3 o ano todo (o Brasil não tem horário de verão desde 2019). */
export const BUSINESS_UTC_OFFSET_MINUTES = -180;

/** Uma entrega concluída, como o motorista a enxerga no histórico. */
export interface SettledDelivery {
  deliveredAt: string;
  fareCents: Cents;
  platformFeeCents: Cents;
  associationFeeCents: Cents;
  workerNetCents: Cents;
}

export interface EarningsTotals {
  deliveries: number;
  grossCents: Cents;
  platformFeeCents: Cents;
  associationFeeCents: Cents;
  netCents: Cents;
}

export interface CompetitorComparison {
  /** O que um app que cobra 25% descontaria do mesmo valor bruto. */
  competitorFeeCents: Cents;
  competitorNetCents: Cents;
  /** Quanto a mais o motorista recebeu na AMMA (nunca negativo no comparativo exibido). */
  extraCents: Cents;
}

/**
 * Comparativo com um app que cobra 25%. A taxa do concorrente é arredondada para CIMA aqui:
 * na dúvida, o comparativo nunca exagera a vantagem da AMMA.
 */
export function compareWithCompetitor(grossCents: Cents, netCents: Cents): CompetitorComparison {
  const competitorFeeCents = Math.ceil((grossCents * COMPETITOR_FEE_PERCENT) / 100);
  const competitorNetCents = grossCents - competitorFeeCents;
  return {
    competitorFeeCents,
    competitorNetCents,
    extraCents: Math.max(0, netCents - competitorNetCents),
  };
}

/** Dia (AAAA-MM-DD) no fuso do negócio. */
export function businessDay(
  at: Date | string,
  offsetMinutes = BUSINESS_UTC_OFFSET_MINUTES,
): string {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) throw new Error('Data inválida');
  return new Date(t + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Os últimos `count` dias (o mais antigo primeiro, terminando no dia de `now`). */
export function lastBusinessDays(
  now: Date,
  count: number,
  offsetMinutes = BUSINESS_UTC_OFFSET_MINUTES,
): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--)
    days.push(businessDay(new Date(now.getTime() - i * 86_400_000), offsetMinutes));
  return days;
}

export function sumDeliveries(list: SettledDelivery[]): EarningsTotals {
  return list.reduce<EarningsTotals>(
    (t, d) => ({
      deliveries: t.deliveries + 1,
      grossCents: t.grossCents + d.fareCents,
      platformFeeCents: t.platformFeeCents + d.platformFeeCents,
      associationFeeCents: t.associationFeeCents + d.associationFeeCents,
      netCents: t.netCents + d.workerNetCents,
    }),
    { deliveries: 0, grossCents: 0, platformFeeCents: 0, associationFeeCents: 0, netCents: 0 },
  );
}

export interface DaySummary extends EarningsTotals {
  date: string;
}

/** Totais por dia dos últimos 7 dias (dias sem entrega aparecem zerados). */
export function weekByDay(list: SettledDelivery[], now: Date, days = 7): DaySummary[] {
  return lastBusinessDays(now, days).map((date) => ({
    date,
    ...sumDeliveries(list.filter((d) => businessDay(d.deliveredAt) === date)),
  }));
}

/** Simulador: quanto sobra de um valor bruto, nas taxas da AMMA e no concorrente de 25%. */
export function simulateEarnings(grossCents: Cents, associationRate: AssociationRate) {
  const fees = calculateRideFees(grossCents, associationRate);
  return { ...fees, ...compareWithCompetitor(grossCents, fees.workerNetCents) };
}

export interface OfferBreakdown {
  grossCents: Cents;
  platformFeeCents: Cents;
  associationFeeCents: Cents;
  netCents: Cents;
  /** 0, 2 ou 4 quando bate com o líquido informado pela API; null se não bater com nenhuma. */
  associationRate: AssociationRate | null;
}

/**
 * Detalha uma oferta (valor da corrida, taxa base, taxa da associação, líquido) usando só o que a
 * oferta já traz. O líquido é o da API (fonte da verdade); a taxa base é a regra pública de 10%.
 */
export function offerBreakdown(fareCents: Cents, estimatedNetCents: Cents): OfferBreakdown {
  const platformFeeCents = calculateRideFees(fareCents, 0).platformFeeCents;
  const associationRate =
    ASSOCIATION_RATES.find(
      (r) => calculateRideFees(fareCents, r).workerNetCents === estimatedNetCents,
    ) ?? null;
  return {
    grossCents: fareCents,
    platformFeeCents,
    associationFeeCents: fareCents - platformFeeCents - estimatedNetCents,
    netCents: estimatedNetCents,
    associationRate,
  };
}
