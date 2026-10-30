import { BUSINESS_UTC_OFFSET_MINUTES } from './earnings';
import { MIN_QUOTAS_TO_BE_MEMBER } from './membership';
import type { Cents } from './money';

/**
 * Sobras anuais: o valor a distribuir (informado pela associação depois de fechar as contas do ano)
 * é dividido entre os sócios por USO (valor das entregas/corridas concluídas no ano) e por COTAS
 * (saldo no fim do ano). `useWeightPercent` diz quanto do total vai pelo uso; o resto, pelas cotas.
 * Aritmética exata (BigInt) e a soma das partes é sempre igual ao total, centavo a centavo.
 */
export const DEFAULT_USE_WEIGHT_PERCENT = 50;

export interface SurplusMember {
  userId: string;
  quotas: number;
  /** Valor bruto das corridas/entregas concluídas no ano, em centavos. */
  useCents: Cents;
}

export interface SurplusParams {
  distributableCents: Cents;
  useWeightPercent: number;
}

export interface SurplusShare extends SurplusMember {
  amountCents: Cents;
}

export interface SurplusResult {
  shares: SurplusShare[];
  distributedCents: Cents;
  totalQuotas: number;
  totalUseCents: Cents;
  memberCount: number;
}

export function calculateSurplus(
  members: readonly SurplusMember[],
  params: SurplusParams,
): SurplusResult {
  const { distributableCents: total, useWeightPercent } = params;
  if (!Number.isInteger(total) || total <= 0)
    throw new Error('O valor das sobras deve ser positivo, em centavos');
  if (!Number.isInteger(useWeightPercent) || useWeightPercent < 0 || useWeightPercent > 100)
    throw new Error('O peso do uso deve ser inteiro de 0 a 100');
  const eligible = members
    .filter((m) => m.quotas >= MIN_QUOTAS_TO_BE_MEMBER)
    .sort((a, b) => a.userId.localeCompare(b.userId));
  if (eligible.length === 0) throw new Error('Não há sócios para dividir as sobras');
  if (new Set(eligible.map((m) => m.userId)).size !== eligible.length)
    throw new Error('Sócio repetido na lista');

  const totalQuotas = eligible.reduce((s, m) => s + m.quotas, 0);
  const totalUse = eligible.reduce((s, m) => s + m.useCents, 0);
  // Sem nenhum uso no ano, tudo vai pelas cotas (não se divide por zero).
  const useW = BigInt(totalUse === 0 ? 0 : useWeightPercent);
  const quotaW = 100n - useW;
  const Tq = BigInt(totalQuotas);
  const Tu = BigInt(totalUse === 0 ? 1 : totalUse);
  const den = 100n * Tq * Tu;
  const D = BigInt(total);

  // parte_i = D × (useW·uso_i/Tu + quotaW·cotas_i/Tq) / 100, tudo sobre o mesmo denominador.
  const parts = eligible.map((m) => {
    const num = useW * BigInt(m.useCents) * Tq + quotaW * BigInt(m.quotas) * Tu;
    return { m, floor: (D * num) / den, rest: (D * num) % den };
  });
  let leftover = Number(D - parts.reduce((s, p) => s + p.floor, 0n));
  // Os centavos que sobraram dos arredondamentos vão para os maiores restos (empate: id).
  const order = [...parts].sort((a, b) =>
    a.rest === b.rest ? a.m.userId.localeCompare(b.m.userId) : a.rest > b.rest ? -1 : 1,
  );
  const extra = new Map<string, number>();
  for (const p of order) {
    if (leftover <= 0) break;
    extra.set(p.m.userId, 1);
    leftover--;
  }
  const shares = parts.map((p) => ({
    ...p.m,
    amountCents: Number(p.floor) + (extra.get(p.m.userId) ?? 0),
  }));
  return {
    shares,
    distributedCents: shares.reduce((s, x) => s + x.amountCents, 0),
    totalQuotas,
    totalUseCents: totalUse,
    memberCount: shares.length,
  };
}

/** Intervalo [início, fim) do ano civil no fuso de João Pessoa, em UTC. */
export function businessYearRange(year: number): { start: Date; end: Date } {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error('Ano inválido');
  const shift = -BUSINESS_UTC_OFFSET_MINUTES * 60_000;
  return {
    start: new Date(Date.UTC(year, 0, 1) + shift),
    end: new Date(Date.UTC(year + 1, 0, 1) + shift),
  };
}

/** O ano só pode ser fechado depois de terminar. */
export const isYearOver = (year: number, now: Date): boolean =>
  now.getTime() >= businessYearRange(year).end.getTime();
