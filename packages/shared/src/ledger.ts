import { calculateRideFees, type AssociationRate } from './fees';
import { assertCents, type Cents } from './money';
import { QUOTA_VALUE_CENTS, type QuotaBalance } from './quotas';

/**
 * Livro-razão em PARTIDAS DOBRADAS (puro, em memória; a persistência vem depois).
 * - Toda transação tem débitos e créditos de mesmo total.
 * - Lançamentos nunca são editados nem apagados: só estornados (nova transação inversa).
 * - O app NÃO guarda dinheiro: o ledger é contábil. O dinheiro real fica com o parceiro de pagamento.
 *
 * Contas (ver docs/REGRAS_FINANCEIRAS.md):
 *   PARTNER_RECEIVABLE   (devedora)  valor a receber do parceiro de pagamento
 *   WORKER_BALANCE:<id>  (credora)   ganhos líquidos a pagar ao trabalhador
 *   PLATFORM_REVENUE     (credora)   taxa base de 10%
 *   WORKER_QUOTAS:<id>   (credora)   taxa de associação do trabalhador, em centavos (vira cotas)
 */
export const PARTNER_RECEIVABLE = 'PARTNER_RECEIVABLE';
export const PLATFORM_REVENUE = 'PLATFORM_REVENUE';
export const workerBalanceAccount = (userId: string) => `WORKER_BALANCE:${userId}`;
export const workerQuotasAccount = (userId: string) => `WORKER_QUOTAS:${userId}`;

export type Direction = 'DEBIT' | 'CREDIT';
export type LedgerKind = 'RIDE_SETTLEMENT' | 'REVERSAL';

export interface Posting {
  readonly account: string;
  readonly direction: Direction;
  readonly amountCents: Cents;
}

export interface LedgerTransaction {
  readonly id: string;
  readonly kind: LedgerKind;
  /** Ex.: id da corrida. */
  readonly reference?: string;
  /** ISO 8601 em UTC. */
  readonly createdAt: string;
  readonly postings: readonly Posting[];
  /** Presente só em estornos: id da transação estornada. */
  readonly reversalOf?: string;
}

/** Monta a transação de fechamento de uma corrida (não grava; use Ledger.post). */
export function buildRideSettlement(input: {
  id: string;
  rideId: string;
  workerId: string;
  grossCents: Cents;
  associationRate: AssociationRate;
  createdAt: string;
}): LedgerTransaction {
  const fees = calculateRideFees(input.grossCents, input.associationRate);
  const credit = (account: string, amountCents: Cents): Posting[] =>
    amountCents > 0 ? [{ account, direction: 'CREDIT', amountCents }] : [];
  return {
    id: input.id,
    kind: 'RIDE_SETTLEMENT',
    reference: input.rideId,
    createdAt: input.createdAt,
    postings: [
      { account: PARTNER_RECEIVABLE, direction: 'DEBIT', amountCents: fees.grossCents },
      ...credit(workerBalanceAccount(input.workerId), fees.workerNetCents),
      ...credit(PLATFORM_REVENUE, fees.platformFeeCents),
      ...credit(workerQuotasAccount(input.workerId), fees.associationFeeCents),
    ],
  };
}

/** Lança erro se a transação for inválida (vazia, valor não inteiro/positivo ou desbalanceada). */
export function assertBalanced(tx: LedgerTransaction): void {
  if (tx.postings.length < 2) throw new Error('Transação precisa de ao menos 2 lançamentos');
  let debit = 0;
  let credit = 0;
  for (const p of tx.postings) {
    assertCents(p.amountCents, 'amountCents');
    if (p.amountCents === 0) throw new Error('Lançamento com valor zero não é permitido');
    if (p.direction === 'DEBIT') debit += p.amountCents;
    else credit += p.amountCents;
  }
  if (debit !== credit)
    throw new Error(`Transação desbalanceada: débitos ${debit} != créditos ${credit}`);
}

/** Só acrescenta (append-only). Corrigir um erro = estornar e lançar de novo. */
export class Ledger {
  private readonly txs: LedgerTransaction[] = [];

  get transactions(): readonly LedgerTransaction[] {
    return this.txs;
  }

  post(tx: LedgerTransaction): void {
    assertBalanced(tx);
    if (this.txs.some((t) => t.id === tx.id)) throw new Error(`Transação ${tx.id} já existe`);
    this.txs.push(
      Object.freeze({
        ...tx,
        postings: Object.freeze(tx.postings.map((p) => Object.freeze({ ...p }))),
      }),
    );
  }

  /** Cria e grava a transação inversa. Cada transação só pode ser estornada uma vez. */
  reverse(txId: string, newId: string, createdAt: string): LedgerTransaction {
    const original = this.txs.find((t) => t.id === txId);
    if (!original) throw new Error(`Transação ${txId} não encontrada`);
    if (original.kind === 'REVERSAL') throw new Error('Não é possível estornar um estorno');
    if (this.txs.some((t) => t.reversalOf === txId))
      throw new Error(`Transação ${txId} já foi estornada`);
    const reversal: LedgerTransaction = {
      id: newId,
      kind: 'REVERSAL',
      reference: original.reference,
      createdAt,
      reversalOf: txId,
      postings: original.postings.map((p) => ({
        ...p,
        direction: p.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      })),
    };
    this.post(reversal);
    return reversal;
  }

  /** Saldo de conta devedora (ativo): débitos - créditos. */
  debitBalance(account: string): Cents {
    return this.sum(account, 'DEBIT') - this.sum(account, 'CREDIT');
  }

  /** Saldo de conta credora (passivo/receita): créditos - débitos. */
  creditBalance(account: string): Cents {
    return this.sum(account, 'CREDIT') - this.sum(account, 'DEBIT');
  }

  /** Cotas do trabalhador, derivadas do saldo da conta de cotas (a fração fica no resto). */
  quotaBalance(userId: string): QuotaBalance {
    const cents = this.creditBalance(workerQuotasAccount(userId));
    return {
      quotas: Math.floor(cents / QUOTA_VALUE_CENTS),
      remainderCents: cents % QUOTA_VALUE_CENTS,
    };
  }

  private sum(account: string, direction: Direction): Cents {
    let total = 0;
    for (const t of this.txs) {
      for (const p of t.postings)
        if (p.account === account && p.direction === direction) total += p.amountCents;
    }
    return total;
  }
}
