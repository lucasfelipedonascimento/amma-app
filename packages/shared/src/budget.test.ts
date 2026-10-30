import { describe, expect, it } from 'vitest';
import { summarizeBudget, validateBudgetEntry, type BudgetLine } from './budget';

const ok = {
  kind: 'DESPESA',
  category: 'JURIDICO',
  description: 'Parecer sobre a lei',
  amountCents: 5000,
};

describe('validateBudgetEntry', () => {
  it('aceita lançamento válido', () => expect(validateBudgetEntry(ok)).toBeNull());
  it('categoria tem de combinar com o tipo', () =>
    expect(validateBudgetEntry({ ...ok, category: 'DOACAO' })).toMatch(/Categoria/));
  it('taxa base só vem do ledger', () =>
    expect(validateBudgetEntry({ ...ok, kind: 'RECEITA', category: 'TAXA_BASE' })).toMatch(
      /Categoria/,
    ));
  it('valor positivo e inteiro', () => {
    expect(validateBudgetEntry({ ...ok, amountCents: 0 })).toMatch(/maior que zero/);
    expect(validateBudgetEntry({ ...ok, amountCents: 10.5 })).not.toBeNull();
  });
  it('descrição', () =>
    expect(validateBudgetEntry({ ...ok, description: 'ab' })).toMatch(/pelo menos/));
  it('tipo inválido', () =>
    expect(validateBudgetEntry({ ...ok, kind: 'X' })).toBe('Tipo inválido'));
});

describe('summarizeBudget', () => {
  const lines: BudgetLine[] = [
    { kind: 'RECEITA', category: 'TAXA_BASE', amountCents: 10_000, occurredOn: '2026-09-10' },
    { kind: 'RECEITA', category: 'DOACAO', amountCents: 2_000, occurredOn: '2026-10-02' },
    { kind: 'DESPESA', category: 'INFRAESTRUTURA', amountCents: 3_000, occurredOn: '2026-10-05' },
    { kind: 'DESPESA', category: 'JURIDICO', amountCents: 500, occurredOn: '2026-09-20' },
  ];
  it('totais e saldo', () => {
    const s = summarizeBudget(lines);
    expect(s.revenueCents).toBe(12_000);
    expect(s.expenseCents).toBe(3_500);
    expect(s.balanceCents).toBe(8_500);
  });
  it('por mês em ordem crescente', () =>
    expect(summarizeBudget(lines).byMonth).toEqual([
      { month: '2026-09', revenueCents: 10_000, expenseCents: 500 },
      { month: '2026-10', revenueCents: 2_000, expenseCents: 3_000 },
    ]));
  it('categorias da maior para a menor', () =>
    expect(summarizeBudget(lines).byCategory.map((c) => c.category)).toEqual([
      'TAXA_BASE',
      'INFRAESTRUTURA',
      'DOACAO',
      'JURIDICO',
    ]));
  it('vazio', () => expect(summarizeBudget([]).balanceCents).toBe(0));
});
