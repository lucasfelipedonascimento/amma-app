import { Injectable } from '@nestjs/common';
import { QUOTA_VALUE_CENTS, isMember, levelProgress, workerQuotasAccount } from '@amma/shared';
import { PrismaService } from '../prisma.service';

/** Cotas e condição de sócio, sempre lidas do ledger (a fonte da verdade). */
@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Saldo da conta de cotas em centavos (créditos − débitos), opcionalmente até uma data. */
  async quotaCents(userId: string, asOf?: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ cents: bigint | null }[]>`
      SELECT SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountCents" ELSE -p."amountCents" END) AS cents
      FROM "LedgerPosting" p JOIN "LedgerTransaction" t ON t.id = p."transactionId"
      WHERE p.account = ${workerQuotasAccount(userId)} AND (${asOf ?? null}::timestamptz IS NULL OR t."createdAt" < ${asOf ?? null}::timestamptz)`;
    return Number(rows[0]?.cents ?? 0);
  }

  async balance(userId: string, asOf?: Date) {
    const cents = await this.quotaCents(userId, asOf);
    return {
      quotas: Math.floor(cents / QUOTA_VALUE_CENTS),
      remainderCents: cents % QUOTA_VALUE_CENTS,
    };
  }

  async quotasOf(userId: string): Promise<number> {
    return (await this.balance(userId)).quotas;
  }

  async isMember(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    return !!user && !user.deletedAt && isMember(await this.quotasOf(userId));
  }

  /** Todos os sócios (cotas ≥ mínimo, conta ativa) com suas cotas, até `asOf` se informado. */
  async listMembers(asOf?: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ userId: string; cents: bigint }[]>`
      SELECT substring(p.account from 15) AS "userId",
             SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountCents" ELSE -p."amountCents" END) AS cents
      FROM "LedgerPosting" p JOIN "LedgerTransaction" t ON t.id = p."transactionId"
      WHERE p.account LIKE 'WORKER_QUOTAS:%' AND (${asOf ?? null}::timestamptz IS NULL OR t."createdAt" < ${asOf ?? null}::timestamptz)
      GROUP BY p.account`;
    const active = new Set(
      (
        await this.prisma.user.findMany({
          where: { id: { in: rows.map((r) => r.userId) }, deletedAt: null },
          select: { id: true },
        })
      ).map((u) => u.id),
    );
    const out = new Map<string, number>();
    for (const r of rows) {
      const quotas = Math.floor(Number(r.cents) / QUOTA_VALUE_CENTS);
      if (active.has(r.userId) && isMember(quotas)) out.set(r.userId, quotas);
    }
    return out;
  }

  progress(balance: { quotas: number; remainderCents: number }) {
    return levelProgress(balance);
  }
}
