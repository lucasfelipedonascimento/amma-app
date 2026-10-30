import { Injectable } from '@nestjs/common';
import {
  PARTNER_RECEIVABLE,
  PLATFORM_REVENUE,
  QUOTA_VALUE_CENTS,
  assertBalanced,
  levelForQuotas,
  workerBalanceAccount,
  workerQuotasAccount,
  type LedgerTransaction,
} from '@amma/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/**
 * Ledger persistido (tabelas LedgerTransaction/LedgerPosting, somente inserção — o banco
 * recusa UPDATE/DELETE). A montagem das partidas é do `shared` (buildRideSettlement).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava dentro da transação do chamador: ou o pedido e o ledger mudam juntos, ou nada muda. */
  async post(tx: Prisma.TransactionClient, t: LedgerTransaction): Promise<void> {
    assertBalanced(t);
    if (!t.reference) throw new Error('Transação do ledger precisa de referência');
    await tx.ledgerTransaction.create({
      data: {
        id: t.id,
        kind: t.kind,
        reference: t.reference,
        reversalOf: t.reversalOf,
        createdAt: new Date(t.createdAt),
        postings: {
          create: t.postings.map((p) => ({
            account: p.account,
            direction: p.direction,
            amountCents: p.amountCents,
          })),
        },
      },
    });
  }

  /** Saldo de conta credora: créditos − débitos. */
  async creditBalance(account: string): Promise<number> {
    const rows = await this.prisma.ledgerPosting.groupBy({
      by: ['direction'],
      where: { account },
      _sum: { amountCents: true },
    });
    const sum = (d: 'DEBIT' | 'CREDIT') =>
      rows.find((r) => r.direction === d)?._sum.amountCents ?? 0;
    return sum('CREDIT') - sum('DEBIT');
  }

  async debitBalance(account: string): Promise<number> {
    return -(await this.creditBalance(account));
  }

  async wallet(userId: string) {
    const [balanceCents, quotaCents] = await Promise.all([
      this.creditBalance(workerBalanceAccount(userId)),
      this.creditBalance(workerQuotasAccount(userId)),
    ]);
    const quotas = Math.floor(quotaCents / QUOTA_VALUE_CENTS);
    return {
      balanceCents,
      quotas,
      remainderCents: quotaCents % QUOTA_VALUE_CENTS,
      level: levelForQuotas(quotas),
    };
  }

  /** Contas globais, para conferência (admin/testes). */
  async totals() {
    return {
      partnerReceivableCents: await this.debitBalance(PARTNER_RECEIVABLE),
      platformRevenueCents: await this.creditBalance(PLATFORM_REVENUE),
    };
  }
}
