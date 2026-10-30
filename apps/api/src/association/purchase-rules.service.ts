import { Injectable } from '@nestjs/common';
import { DEFAULT_PURCHASE_RULES, type PurchaseRules } from '@amma/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/**
 * Regras da fila da compra coletiva em vigor. Só mudam por proposta aprovada na assembleia
 * (AssemblyService cria a versão). Sem versão gravada, vale o padrão do código.
 */
@Injectable()
export class PurchaseRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async current(
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<PurchaseRules> {
    const v = await db.purchaseRulesVersion.findFirst({
      where: { effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    });
    return v
      ? { ...DEFAULT_PURCHASE_RULES, ...(v.rules as Partial<PurchaseRules>) }
      : DEFAULT_PURCHASE_RULES;
  }

  async history() {
    return this.prisma.purchaseRulesVersion.findMany({
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, rules: true, proposalId: true, effectiveFrom: true },
    });
  }
}
