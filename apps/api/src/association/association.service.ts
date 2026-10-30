import { Injectable } from '@nestjs/common';
import {
  ASSOCIATION_RATES,
  MIN_QUOTAS_TO_BE_MEMBER,
  QUOTA_VALUE_CENTS,
  isMember,
  levelProgress,
  workerQuotasAccount,
} from '@amma/shared';
import { PrismaService } from '../prisma.service';
import { MembersService } from './members.service';
import { PurchaseRulesService } from './purchase-rules.service';

/** Resumo do sócio: taxa escolhida, cotas, nível e quanto falta para o próximo. */
@Injectable()
export class AssociationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly rules: PurchaseRulesService,
  ) {}

  async me(userId: string) {
    const [profile, balance] = await Promise.all([
      this.prisma.driverProfile.findUnique({
        where: { userId },
        select: { associationRate: true },
      }),
      this.members.balance(userId),
    ]);
    // Últimas taxas que viraram cota (cada corrida/entrega concluída com taxa > 0).
    const credits = await this.prisma.ledgerPosting.findMany({
      where: { account: workerQuotasAccount(userId) },
      orderBy: { transaction: { createdAt: 'desc' } },
      take: 20,
      select: {
        direction: true,
        amountCents: true,
        transaction: { select: { kind: true, createdAt: true } },
      },
    });
    return {
      associationRate: profile?.associationRate ?? 0,
      rateOptions: ASSOCIATION_RATES,
      quotaValueCents: QUOTA_VALUE_CENTS,
      quotas: balance.quotas,
      remainderCents: balance.remainderCents,
      isMember: isMember(balance.quotas),
      minQuotasToBeMember: MIN_QUOTAS_TO_BE_MEMBER,
      progress: levelProgress(balance),
      history: credits.map((c) => ({
        at: c.transaction.createdAt,
        kind: c.transaction.kind,
        cents: c.direction === 'CREDIT' ? c.amountCents : -c.amountCents,
      })),
    };
  }

  purchaseRules() {
    return this.rules.current();
  }
}
