import { describe, expect, it } from 'vitest';
import {
  ASSOCIATION_SURPLUS,
  Ledger,
  PARTNER_RECEIVABLE,
  PLATFORM_REVENUE,
  assertBalanced,
  buildGroupContribution,
  buildRideSettlement,
  buildSurplusDistribution,
  memberGroupAccount,
  partnerGroupAccount,
  workerBalanceAccount,
  workerQuotasAccount,
} from './ledger';

const at = '2026-10-29T12:00:00Z';
const settle = (id: string, gross: number, rate: 0 | 2 | 4 = 0, worker = 'w1') =>
  buildRideSettlement({
    id,
    rideId: `ride-${id}`,
    workerId: worker,
    grossCents: gross,
    associationRate: rate,
    createdAt: at,
  });

describe('buildRideSettlement', () => {
  it('R$ 11,00 com 2%: trabalhador recebe R$ 9,68', () => {
    const l = new Ledger();
    l.post(settle('t1', 1100, 2));
    expect(l.creditBalance(workerBalanceAccount('w1'))).toBe(968);
    expect(l.creditBalance(PLATFORM_REVENUE)).toBe(110);
    expect(l.creditBalance(workerQuotasAccount('w1'))).toBe(22);
    expect(l.debitBalance(PARTNER_RECEIVABLE)).toBe(1100);
  });
  it('sem associação não cria lançamento de cotas', () => {
    const tx = settle('t1', 2000, 0);
    expect(tx.postings.some((p) => p.account.startsWith('WORKER_QUOTAS'))).toBe(false);
    assertBalanced(tx);
  });
  it('é sempre balanceada, inclusive com centavos quebrados', () => {
    for (const gross of [1, 9, 99, 101, 1999, 12345])
      for (const rate of [0, 2, 4] as const) assertBalanced(settle('x', gross, rate));
  });
  it('corrida de R$ 0 é inválida (lançamentos zerados)', () => {
    expect(() => assertBalanced(settle('z', 0))).toThrow();
  });
});

describe('Ledger', () => {
  it('rejeita transação desbalanceada, id repetido e valores inválidos', () => {
    const l = new Ledger();
    const bad = {
      ...settle('t1', 1000),
      postings: [
        { account: 'A', direction: 'DEBIT' as const, amountCents: 100 },
        { account: 'B', direction: 'CREDIT' as const, amountCents: 99 },
      ],
    };
    expect(() => l.post(bad)).toThrow(/desbalanceada/);
    l.post(settle('t1', 1000));
    expect(() => l.post(settle('t1', 1000))).toThrow(/já existe/);
    expect(() =>
      assertBalanced({
        ...bad,
        postings: [
          { account: 'A', direction: 'DEBIT', amountCents: 1.5 },
          { account: 'B', direction: 'CREDIT', amountCents: 1.5 },
        ],
      }),
    ).toThrow();
  });
  it('lançamentos são imutáveis', () => {
    const l = new Ledger();
    l.post(settle('t1', 1000, 4));
    const tx = l.transactions[0];
    expect(() => {
      (tx.postings[0] as { amountCents: number }).amountCents = 1;
    }).toThrow();
    expect(() => {
      (tx as { id: string }).id = 'x';
    }).toThrow();
  });
  it('estorno zera os saldos e mantém o histórico', () => {
    const l = new Ledger();
    l.post(settle('t1', 1100, 2));
    const rev = l.reverse('t1', 'r1', at);
    expect(rev.reversalOf).toBe('t1');
    expect(l.transactions).toHaveLength(2);
    expect(l.creditBalance(workerBalanceAccount('w1'))).toBe(0);
    expect(l.debitBalance(PARTNER_RECEIVABLE)).toBe(0);
    expect(l.quotaBalance('w1')).toEqual({ quotas: 0, remainderCents: 0 });
  });
  it('não estorna duas vezes, nem estorno, nem transação inexistente', () => {
    const l = new Ledger();
    l.post(settle('t1', 1000));
    l.reverse('t1', 'r1', at);
    expect(() => l.reverse('t1', 'r2', at)).toThrow(/já foi estornada/);
    expect(() => l.reverse('r1', 'r3', at)).toThrow(/estorno/);
    expect(() => l.reverse('nope', 'r4', at)).toThrow(/não encontrada/);
  });
  it('cotas: acumula fração entre corridas e converte em cotas (1 cota = R$ 5)', () => {
    const l = new Ledger();
    // 4% de R$ 62,50 = R$ 2,50 (250) por corrida
    l.post(settle('a', 6250, 4));
    expect(l.quotaBalance('w1')).toEqual({ quotas: 0, remainderCents: 250 });
    l.post(settle('b', 6250, 4));
    expect(l.quotaBalance('w1')).toEqual({ quotas: 1, remainderCents: 0 });
    l.post(settle('c', 6250, 4));
    expect(l.quotaBalance('w1')).toEqual({ quotas: 1, remainderCents: 250 });
  });
  it('saldos de trabalhadores diferentes não se misturam', () => {
    const l = new Ledger();
    l.post(settle('a', 1000, 2, 'w1'));
    l.post(settle('b', 3000, 2, 'w2'));
    expect(l.creditBalance(workerBalanceAccount('w1'))).toBe(880);
    expect(l.creditBalance(workerBalanceAccount('w2'))).toBe(2640);
    expect(l.creditBalance(PLATFORM_REVENUE)).toBe(400);
  });
  it('conservação: soma de todos os débitos == soma de todos os créditos', () => {
    const l = new Ledger();
    [1100, 1999, 5, 7777].forEach((g, i) => l.post(settle(`t${i}`, g, 4)));
    l.reverse('t1', 'rev', at);
    let d = 0,
      c = 0;
    for (const t of l.transactions)
      for (const p of t.postings)
        if (p.direction === 'DEBIT') d += p.amountCents;
        else c += p.amountCents;
    expect(d).toBe(c);
  });
});

describe('aporte de compra coletiva', () => {
  const tx = buildGroupContribution({
    id: 't1',
    contributionId: 'c1',
    groupId: 'g1',
    userId: 'u1',
    amountCents: 25_000,
    createdAt: '2026-11-01T12:00:00Z',
  });
  it('é uma transação balanceada que só registra (sem tocar nos ganhos do sócio)', () => {
    expect(() => assertBalanced(tx)).not.toThrow();
    expect(tx.kind).toBe('GROUP_CONTRIBUTION');
    expect(tx.reference).toBe('c1');
    expect(tx.postings.map((p) => p.account)).toEqual([
      partnerGroupAccount('g1'),
      memberGroupAccount('g1', 'u1'),
    ]);
  });
  it('soma por grupo e por sócio, e pode ser estornada', () => {
    const l = new Ledger();
    l.post(tx);
    expect(l.debitBalance(partnerGroupAccount('g1'))).toBe(25_000);
    expect(l.creditBalance(memberGroupAccount('g1', 'u1'))).toBe(25_000);
    expect(l.creditBalance(workerBalanceAccount('u1'))).toBe(0);
    l.reverse('t1', 't2', '2026-11-02T12:00:00Z');
    expect(l.creditBalance(memberGroupAccount('g1', 'u1'))).toBe(0);
  });
});

describe('sobras anuais', () => {
  const build = (shares: { userId: string; amountCents: number }[]) =>
    buildSurplusDistribution({ id: 't1', runId: 'r1', shares, createdAt: '2026-11-01T12:00:00Z' });
  it('debita o total e credita a parte de cada sócio', () => {
    const tx = build([
      { userId: 'a', amountCents: 700 },
      { userId: 'b', amountCents: 300 },
    ]);
    expect(() => assertBalanced(tx)).not.toThrow();
    const l = new Ledger();
    l.post(tx);
    expect(l.debitBalance(ASSOCIATION_SURPLUS)).toBe(1000);
    expect(l.creditBalance(workerBalanceAccount('a'))).toBe(700);
    expect(l.creditBalance(workerBalanceAccount('b'))).toBe(300);
  });
  it('parte zero não gera lançamento (valor zero é proibido no ledger)', () => {
    const tx = build([
      { userId: 'a', amountCents: 1000 },
      { userId: 'b', amountCents: 0 },
    ]);
    expect(tx.postings).toHaveLength(2);
    expect(() => assertBalanced(tx)).not.toThrow();
  });
});
