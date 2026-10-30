import type { Cents } from './money';

/**
 * Orçamento aberto da associação, visível aos sócios.
 * Receitas: as taxas vêm do ledger (PLATFORM_REVENUE) e o admin lança outras receitas e todas as despesas.
 * Lançamentos manuais nunca são editados nem apagados: o erro se corrige com um estorno (novo lançamento).
 */
export const BUDGET_KINDS = ['RECEITA', 'DESPESA'] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

export const REVENUE_CATEGORIES = ['OUTRA_RECEITA', 'DOACAO', 'PARCERIA'] as const;
export const EXPENSE_CATEGORIES = [
  'INFRAESTRUTURA',
  'PESSOAL',
  'JURIDICO',
  'CONTABILIDADE',
  'SEGURO',
  'MARKETING',
  'OUTRA_DESPESA',
] as const;
export type BudgetCategory =
  (typeof REVENUE_CATEGORIES)[number] | (typeof EXPENSE_CATEGORIES)[number] | 'TAXA_BASE';

export const BUDGET_CATEGORY_LABEL: Record<BudgetCategory, string> = {
  TAXA_BASE: 'Taxa base das corridas (10%)',
  OUTRA_RECEITA: 'Outras receitas',
  DOACAO: 'Doações',
  PARCERIA: 'Parcerias',
  INFRAESTRUTURA: 'Infraestrutura e sistemas',
  PESSOAL: 'Pessoal',
  JURIDICO: 'Jurídico',
  CONTABILIDADE: 'Contabilidade',
  SEGURO: 'Seguro',
  MARKETING: 'Divulgação',
  OUTRA_DESPESA: 'Outras despesas',
};

export const categoriesOf = (kind: BudgetKind): readonly BudgetCategory[] =>
  kind === 'RECEITA' ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES;

export const BUDGET_DESCRIPTION_MIN = 5;
export const BUDGET_DESCRIPTION_MAX = 300;

export function validateBudgetEntry(e: {
  kind: string;
  category: string;
  description: string;
  amountCents: number;
}): string | null {
  if (!(BUDGET_KINDS as readonly string[]).includes(e.kind)) return 'Tipo inválido';
  if (!(categoriesOf(e.kind as BudgetKind) as readonly string[]).includes(e.category))
    return 'Categoria inválida para este tipo';
  if (!Number.isInteger(e.amountCents) || e.amountCents <= 0)
    return 'Valor deve ser maior que zero';
  const d = e.description.trim();
  if (d.length < BUDGET_DESCRIPTION_MIN)
    return `Descreva com pelo menos ${BUDGET_DESCRIPTION_MIN} caracteres`;
  if (d.length > BUDGET_DESCRIPTION_MAX)
    return `Descrição com no máximo ${BUDGET_DESCRIPTION_MAX} caracteres`;
  return null;
}

export interface BudgetLine {
  kind: BudgetKind;
  category: BudgetCategory;
  amountCents: Cents;
  /** Data do fato (YYYY-MM-DD), não a do registro. */
  occurredOn: string;
}

export interface BudgetSummary {
  revenueCents: Cents;
  expenseCents: Cents;
  balanceCents: Cents;
  byCategory: { kind: BudgetKind; category: BudgetCategory; totalCents: Cents }[];
  byMonth: { month: string; revenueCents: Cents; expenseCents: Cents }[];
}

/** Soma as linhas (já sem as estornadas). `byMonth` em ordem crescente; categorias da maior para a menor. */
export function summarizeBudget(lines: readonly BudgetLine[]): BudgetSummary {
  const cat = new Map<string, { kind: BudgetKind; category: BudgetCategory; totalCents: number }>();
  const months = new Map<string, { revenueCents: number; expenseCents: number }>();
  let revenueCents = 0;
  let expenseCents = 0;
  for (const l of lines) {
    if (l.kind === 'RECEITA') revenueCents += l.amountCents;
    else expenseCents += l.amountCents;
    const key = `${l.kind}:${l.category}`;
    const c = cat.get(key) ?? { kind: l.kind, category: l.category, totalCents: 0 };
    c.totalCents += l.amountCents;
    cat.set(key, c);
    const month = l.occurredOn.slice(0, 7);
    const m = months.get(month) ?? { revenueCents: 0, expenseCents: 0 };
    if (l.kind === 'RECEITA') m.revenueCents += l.amountCents;
    else m.expenseCents += l.amountCents;
    months.set(month, m);
  }
  return {
    revenueCents,
    expenseCents,
    balanceCents: revenueCents - expenseCents,
    byCategory: [...cat.values()].sort((a, b) => b.totalCents - a.totalCents),
    byMonth: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v })),
  };
}
