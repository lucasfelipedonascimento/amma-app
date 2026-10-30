import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PLATFORM_REVENUE,
  summarizeBudget,
  validateBudgetEntry,
  type BudgetCategory,
  type BudgetKind,
  type BudgetLine,
} from '@amma/shared';
import { PrismaService } from '../prisma.service';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Orçamento aberto. Receita de taxas: lida do ledger (PLATFORM_REVENUE, já líquida de estornos).
 * Demais receitas e todas as despesas: lançamentos do admin, imutáveis (erro = estorno).
 */
@Injectable()
export class BudgetService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    adminId: string,
    dto: {
      kind: BudgetKind;
      category: string;
      description: string;
      amountCents: number;
      occurredOn: string;
      receiptRef?: string;
    },
  ) {
    const err = validateBudgetEntry(dto);
    if (err) throw new BadRequestException(err);
    const date = new Date(`${dto.occurredOn}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || ymd(date) !== dto.occurredOn)
      throw new BadRequestException('Data inválida');
    if (date.getTime() > Date.now() + 86_400_000)
      throw new BadRequestException('A data não pode estar no futuro');
    const e = await this.prisma.budgetEntry.create({
      data: {
        kind: dto.kind,
        category: dto.category,
        description: dto.description.trim(),
        amountCents: dto.amountCents,
        occurredOn: date,
        receiptRef: dto.receiptRef?.trim() || null,
        createdById: adminId,
      },
    });
    return this.entryView(e, false);
  }

  /** Estorna: novo lançamento ligado ao original. Um estorno por lançamento; estorno não se estorna. */
  async reverse(adminId: string, id: string, reason: string) {
    if (reason.trim().length < 5) throw new BadRequestException('Informe o motivo do estorno');
    const orig = await this.prisma.budgetEntry.findUnique({ where: { id } });
    if (!orig) throw new NotFoundException('Lançamento não encontrado');
    if (orig.reversalOf) throw new ConflictException('Um estorno não pode ser estornado');
    try {
      const e = await this.prisma.budgetEntry.create({
        data: {
          kind: orig.kind,
          category: orig.category,
          description: `Estorno: ${reason.trim()}`.slice(0, 300),
          amountCents: orig.amountCents,
          occurredOn: orig.occurredOn,
          createdById: adminId,
          reversalOf: orig.id,
        },
      });
      return this.entryView(e, false);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Este lançamento já foi estornado');
      throw e;
    }
  }

  /** Resumo e lançamentos de um ano (UTC). Lançamento estornado aparece marcado e fora das somas. */
  async year(year: number, showCreator: boolean) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const entries = await this.prisma.budgetEntry.findMany({
      where: { occurredOn: { gte: from, lt: to } },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      include: { createdBy: { select: { name: true } } },
    });
    const reversedIds = new Set(entries.filter((e) => e.reversalOf).map((e) => e.reversalOf!));
    const lines: BudgetLine[] = entries
      .filter((e) => !e.reversalOf && !reversedIds.has(e.id))
      .map((e) => ({
        kind: e.kind,
        category: e.category as BudgetCategory,
        amountCents: e.amountCents,
        occurredOn: ymd(e.occurredOn),
      }));
    for (const f of await this.feeRevenue(from, to)) lines.push(f);
    return {
      year,
      summary: summarizeBudget(lines),
      entries: entries.map((e) => ({
        ...this.entryView(e, reversedIds.has(e.id)),
        // Sócios veem o que entrou e saiu; quem lançou só aparece para a equipe.
        createdByName: showCreator ? (e.createdBy.name ?? null) : undefined,
      })),
      note: 'Receita das taxas calculada do livro-razão; demais lançamentos feitos pela administração.',
    };
  }

  /** Taxa base por mês (créditos − débitos em PLATFORM_REVENUE, incluindo estornos). */
  private async feeRevenue(from: Date, to: Date): Promise<BudgetLine[]> {
    const rows = await this.prisma.$queryRaw<{ month: string; cents: bigint }[]>`
      SELECT to_char(date_trunc('month', t."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
             SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountCents" ELSE -p."amountCents" END) AS cents
      FROM "LedgerPosting" p JOIN "LedgerTransaction" t ON t.id = p."transactionId"
      WHERE p.account = ${PLATFORM_REVENUE} AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
      GROUP BY 1`;
    return rows
      .filter((r) => Number(r.cents) > 0)
      .map((r) => ({
        kind: 'RECEITA' as const,
        category: 'TAXA_BASE' as const,
        amountCents: Number(r.cents),
        occurredOn: `${r.month}-01`,
      }));
  }

  private entryView(
    e: {
      id: string;
      kind: string;
      category: string;
      description: string;
      amountCents: number;
      occurredOn: Date;
      receiptRef: string | null;
      reversalOf: string | null;
      createdAt: Date;
    },
    reversed: boolean,
  ) {
    return {
      id: e.id,
      kind: e.kind,
      category: e.category,
      description: e.description,
      amountCents: e.amountCents,
      occurredOn: ymd(e.occurredOn),
      receiptRef: e.receiptRef,
      isReversal: e.reversalOf !== null,
      reversalOf: e.reversalOf,
      reversed,
      createdAt: e.createdAt,
    };
  }
}
