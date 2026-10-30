import { Injectable } from '@nestjs/common';
import { PLATFORM_REVENUE, QUOTA_VALUE_CENTS, levelForQuotas } from '@amma/shared';
import { MembersService } from '../association/members.service';
import { PrismaService } from '../prisma.service';

const STATUS_GROUPS = {
  concluded: ['ENTREGUE'],
  cancelled: ['CANCELADO'],
} as const;

const sumRaw = async (prisma: PrismaService, like: string) => {
  const rows = await prisma.$queryRaw<{ cents: bigint | null }[]>`
    SELECT SUM(CASE WHEN direction = 'CREDIT' THEN "amountCents" ELSE -"amountCents" END) AS cents
    FROM "LedgerPosting" WHERE account LIKE ${like}`;
  return Number(rows[0]?.cents ?? 0);
};

/** Números do painel inicial. Tudo calculado na hora a partir do banco; nada é guardado à parte. */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
  ) {}

  async overview(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [orders, rides, earnings, satisfaction, pointSatisfaction, queues] = await Promise.all([
      this.trips('ENTREGA', since),
      this.trips('CORRIDA', since),
      this.earnings(since),
      this.satisfaction(since),
      this.pointSatisfaction(since),
      this.queues(),
    ]);
    const memberQuotas = await this.members.listMembers();
    const levels = { BRONZE: 0, SILVER: 0, GOLD: 0 };
    let totalQuotas = 0;
    for (const q of memberQuotas.values()) {
      levels[levelForQuotas(q)]++;
      totalQuotas += q;
    }
    const [quotaFundCents, groupFundCents, platformRevenueCents] = await Promise.all([
      sumRaw(this.prisma, 'WORKER_QUOTAS:%'),
      // Aportes de compra coletiva: ficam no parceiro regulado; aqui é só o registro (devedora).
      this.groupFund(),
      sumRaw(this.prisma, PLATFORM_REVENUE),
    ]);
    return {
      periodDays: days,
      since,
      orders,
      rides,
      earnings,
      association: {
        members: memberQuotas.size,
        totalQuotas,
        levels,
        quotaFundCents,
        quotaValueCents: QUOTA_VALUE_CENTS,
        groupFundCents,
        platformRevenueCents,
      },
      satisfaction,
      pointSatisfaction,
      queues,
    };
  }

  private async trips(kind: 'ENTREGA' | 'CORRIDA', since: Date) {
    const grouped = await this.prisma.delivery.groupBy({
      by: ['status'],
      where: { kind, createdAt: { gte: since } },
      _count: true,
    });
    const count = (statuses: readonly string[]) =>
      grouped.filter((g) => statuses.includes(g.status)).reduce((s, g) => s + g._count, 0);
    const total = grouped.reduce((s, g) => s + g._count, 0);
    const concluded = count(STATUS_GROUPS.concluded);
    const cancelled = count(STATUS_GROUPS.cancelled);
    return {
      total,
      concluded,
      cancelled,
      inProgress: total - concluded - cancelled,
      // Taxa de conclusão sobre o que já terminou (concluído ou cancelado); null sem base.
      completionRate: concluded + cancelled > 0 ? concluded / (concluded + cancelled) : null,
    };
  }

  /** Ganhos médios dos trabalhadores no período (valor líquido, depois das taxas). */
  private async earnings(since: Date) {
    const rows = await this.prisma.delivery.groupBy({
      by: ['workerId'],
      where: { status: 'ENTREGUE', deliveredAt: { gte: since }, workerId: { not: null } },
      _sum: {
        fareCents: true,
        workerNetCents: true,
        platformFeeCents: true,
        associationFeeCents: true,
      },
      _count: true,
    });
    const workers = rows.length;
    const trips = rows.reduce((s, r) => s + r._count, 0);
    const net = rows.reduce((s, r) => s + (r._sum.workerNetCents ?? 0), 0);
    return {
      workers,
      trips,
      grossCents: rows.reduce((s, r) => s + (r._sum.fareCents ?? 0), 0),
      netCents: net,
      avgNetPerWorkerCents: workers ? Math.round(net / workers) : null,
      avgNetPerTripCents: trips ? Math.round(net / trips) : null,
    };
  }

  private async satisfaction(since: Date) {
    const rows = await this.prisma.rating.groupBy({
      by: ['direction', 'stars'],
      where: { createdAt: { gte: since } },
      _count: true,
    });
    const part = (direction: string) => {
      const mine = rows.filter((r) => r.direction === direction);
      const count = mine.reduce((s, r) => s + r._count, 0);
      const stars = mine.reduce((s, r) => s + r.stars * r._count, 0);
      return {
        count,
        average: count ? Math.round((stars / count) * 100) / 100 : null,
        distribution: [1, 2, 3, 4, 5].map((n) => mine.find((r) => r.stars === n)?._count ?? 0),
      };
    };
    return {
      clientRatesDriver: part('CLIENTE_AVALIA_MOTORISTA'),
      driverRatesClient: part('MOTORISTA_AVALIA_CLIENTE'),
    };
  }

  private async pointSatisfaction(since: Date) {
    const agg = await this.prisma.pointRating.aggregate({
      where: { createdAt: { gte: since }, direction: 'VISITANTE_AVALIA_PONTO' },
      _avg: { stars: true },
      _count: true,
    });
    return {
      count: agg._count,
      average: agg._avg.stars ? Math.round(agg._avg.stars * 100) / 100 : null,
    };
  }

  /** O que está esperando uma pessoa da associação. */
  private async queues() {
    const [documents, merchants, points, reports, pointReports, alerts, appeals, claims] =
      await Promise.all([
        this.prisma.document.count({ where: { status: 'PENDENTE' } }),
        this.prisma.merchant.count({ where: { approvalStatus: 'PENDENTE' } }),
        this.prisma.welcomePoint.count({ where: { status: 'EM_ANALISE' } }),
        this.prisma.report.count({ where: { status: { in: ['ABERTA', 'EM_ANALISE'] } } }),
        this.prisma.pointReport.count({ where: { status: 'ABERTA' } }),
        this.prisma.emergencyAlert.count({
          where: { status: { in: ['ABERTO', 'EM_ATENDIMENTO'] } },
        }),
        this.prisma.accountBlock.count({ where: { status: 'EM_RECURSO' } }),
        this.prisma.insuranceClaim.count({ where: { status: { in: ['ENVIADA', 'EM_ANALISE'] } } }),
      ]);
    return { documents, merchants, points, reports, pointReports, alerts, appeals, claims };
  }

  private async groupFund() {
    const rows = await this.prisma.$queryRaw<{ cents: bigint | null }[]>`
      SELECT SUM(CASE WHEN direction = 'DEBIT' THEN "amountCents" ELSE -"amountCents" END) AS cents
      FROM "LedgerPosting" WHERE account LIKE 'PARTNER_GROUP:%'`;
    return Number(rows[0]?.cents ?? 0);
  }
}
