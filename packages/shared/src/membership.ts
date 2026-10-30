import { assertCents, type Cents } from './money';
import { QUOTA_VALUE_CENTS, levelForQuotas, type Level, type QuotaBalance } from './quotas';

/**
 * Sócio = quem tem ao menos 1 cota. Só sócios votam (1 sócio = 1 voto), entram na compra coletiva,
 * pedem o seguro mútuo e dividem as sobras. Escolha da associação a confirmar no estatuto.
 */
export const MIN_QUOTAS_TO_BE_MEMBER = 1;

export const isMember = (quotas: number): boolean => quotas >= MIN_QUOTAS_TO_BE_MEMBER;

/** Cotas a partir das quais cada nível começa (Bronze 0–29, Prata 30–59, Ouro 60+). */
export const LEVEL_START_QUOTAS: Record<Level, number> = { BRONZE: 0, SILVER: 30, GOLD: 60 };
const NEXT_LEVEL: Record<Level, Level | null> = { BRONZE: 'SILVER', SILVER: 'GOLD', GOLD: null };

export interface LevelProgress {
  level: Level;
  nextLevel: Level | null;
  /** Cotas que faltam para o próximo nível (null no Ouro). */
  quotasToNext: number | null;
  /** Quanto falta em centavos de taxa de associação, já descontando a fração de cota acumulada. */
  centsToNext: Cents | null;
  /** 0 a 100: quanto da faixa do nível atual já foi percorrido (Ouro = 100). */
  percent: number;
}

export function levelProgress(balance: QuotaBalance): LevelProgress {
  const level = levelForQuotas(balance.quotas);
  const next = NEXT_LEVEL[level];
  if (!next) return { level, nextLevel: null, quotasToNext: null, centsToNext: null, percent: 100 };
  assertCents(balance.remainderCents, 'remainderCents');
  const from = LEVEL_START_QUOTAS[level];
  const to = LEVEL_START_QUOTAS[next];
  const quotasToNext = to - balance.quotas;
  return {
    level,
    nextLevel: next,
    quotasToNext,
    centsToNext: quotasToNext * QUOTA_VALUE_CENTS - balance.remainderCents,
    percent: Math.floor(((balance.quotas - from) / (to - from)) * 100),
  };
}
