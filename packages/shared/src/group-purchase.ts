import type { Cents } from './money';

/**
 * Compra coletiva de veículos. A AMMA NÃO capta dinheiro nem dá crédito: os aportes são REGISTROS
 * (ledger) de valores que o sócio paga ao parceiro regulado (consórcio/cooperativa de crédito).
 * As regras da fila são configuração, alterada só por votação da assembleia.
 */
export interface PurchaseRules {
  /** Pontos por cota na fila. */
  quotaWeight: number;
  /** Pontos por dia de espera na fila. */
  dayWeight: number;
  /** Cotas mínimas para entrar numa fila. */
  minQuotas: number;
  /** Menor aporte aceito, em centavos. */
  minContributionCents: Cents;
}

/** Valores de exemplo (1 cota pesa como 10 dias de espera). A assembleia decide os reais. */
export const DEFAULT_PURCHASE_RULES: PurchaseRules = {
  quotaWeight: 10,
  dayWeight: 1,
  minQuotas: 1,
  minContributionCents: 5_000,
};

export const PURCHASE_RULE_KEYS = Object.keys(DEFAULT_PURCHASE_RULES) as (keyof PurchaseRules)[];

const LIMITS: Record<keyof PurchaseRules, [number, number]> = {
  quotaWeight: [0, 1000],
  dayWeight: [0, 1000],
  minQuotas: [0, 1000],
  minContributionCents: [100, 100_000_00],
};

const LABELS: Record<keyof PurchaseRules, string> = {
  quotaWeight: 'peso da cota',
  dayWeight: 'peso do dia de fila',
  minQuotas: 'mínimo de cotas',
  minContributionCents: 'aporte mínimo',
};

/** Valida uma alteração parcial e devolve as regras resultantes. Lança erro com mensagem em português. */
export function applyRuleChange(current: PurchaseRules, change: unknown): PurchaseRules {
  if (typeof change !== 'object' || change === null || Array.isArray(change))
    throw new Error('Informe a alteração de regra como um objeto');
  const entries = Object.entries(change);
  if (entries.length === 0) throw new Error('Informe ao menos uma regra para alterar');
  const next = { ...current };
  for (const [key, value] of entries) {
    if (!PURCHASE_RULE_KEYS.includes(key as keyof PurchaseRules))
      throw new Error(`Regra desconhecida: ${key}`);
    const k = key as keyof PurchaseRules;
    const [min, max] = LIMITS[k];
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
      throw new Error(`${LABELS[k]} deve ser inteiro de ${min} a ${max}`);
    next[k] = value as number;
  }
  if (next.quotaWeight === 0 && next.dayWeight === 0)
    throw new Error('Os pesos de cota e de tempo não podem ser ambos zero');
  return next;
}

export const canJoinQueue = (quotas: number, rules: PurchaseRules): boolean =>
  quotas >= Math.max(rules.minQuotas, 1);

const DAY_MS = 86_400_000;

/** Pontos na fila: cotas × peso + dias completos de espera × peso. */
export function queueScore(
  quotas: number,
  joinedAt: Date,
  now: Date,
  rules: PurchaseRules,
): number {
  const days = Math.max(0, Math.floor((now.getTime() - joinedAt.getTime()) / DAY_MS));
  return quotas * rules.quotaWeight + days * rules.dayWeight;
}

export interface QueueMember {
  userId: string;
  quotas: number;
  joinedAt: Date;
}

export interface RankedMember extends QueueMember {
  position: number;
  score: number;
}

/** Fila ordenada: mais pontos primeiro; empate = quem entrou antes; depois id (resultado estável). */
export function rankQueue(
  members: readonly QueueMember[],
  now: Date,
  rules: PurchaseRules,
): RankedMember[] {
  return members
    .map((m) => ({ ...m, score: queueScore(m.quotas, m.joinedAt, now, rules) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.joinedAt.getTime() - b.joinedAt.getTime() ||
        a.userId.localeCompare(b.userId),
    )
    .map((m, i) => ({ ...m, position: i + 1 }));
}

/** Quantos veículos o grupo já pode contemplar: aportes confirmados ÷ valor de um veículo, menos os já contemplados. */
export function awardableUnits(fundedCents: Cents, targetCents: Cents, awarded: number): number {
  if (!Number.isInteger(targetCents) || targetCents <= 0) throw new Error('Valor-alvo inválido');
  return Math.max(0, Math.floor(fundedCents / targetCents) - awarded);
}

/** Limite de um aporte no parceiro simulado (acima disso o parceiro de mentira recusa). */
export const SANDBOX_PARTNER_MAX_CONTRIBUTION_CENTS = 10_000_00;
