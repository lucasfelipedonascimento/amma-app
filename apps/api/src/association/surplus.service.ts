import { ConflictException, Injectable, BadRequestException } from '@nestjs/common';
import {
  DEFAULT_USE_WEIGHT_PERCENT,
  buildSurplusDistribution,
  businessYearRange,
  calculateSurplus,
  isYearOver,
} from '@amma/shared';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../common/crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma.service';
import { SurplusSimulateDto } from './dto';
import { MembersService } from './members.service';

/**
 * Sobras anuais. O valor a distribuir é informado pela associação (depois de fechar as contas do
 * ano); aqui só se divide, por uso e por cotas. O fechamento exige a simulação: o `checksum` dela
 * tem de bater com o cálculo atual, então ninguém fecha o que não viu.
 */
@Injectable()
export class SurplusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly ledger: LedgerService,
  ) {}

  /** Calcula sem gravar nada. Cotas = saldo no fim do ano (ou agora, se o ano não acabou). */
  async simulate(dto: SurplusSimulateDto) {
    const { start, end } = businessYearRange(dto.year);
    const now = new Date();
    const over = isYearOver(dto.year, now);
    const quotas = await this.members.listMembers(over ? end : undefined);
    const useByUser = await this.useByWorker(start, end, [...quotas.keys()]);
    const useWeightPercent = dto.useWeightPercent ?? DEFAULT_USE_WEIGHT_PERCENT;
    let result;
    try {
      result = calculateSurplus(
        [...quotas].map(([userId, q]) => ({
          userId,
          quotas: q,
          useCents: useByUser.get(userId) ?? 0,
        })),
        { distributableCents: dto.distributableCents, useWeightPercent },
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const checksum = sha256(
      JSON.stringify({
        year: dto.year,
        distributableCents: dto.distributableCents,
        useWeightPercent,
        shares: result.shares.map((s) => [s.userId, s.quotas, s.useCents, s.amountCents]),
      }),
    );
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: result.shares.map((s) => s.userId) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return {
      year: dto.year,
      distributableCents: dto.distributableCents,
      useWeightPercent,
      yearOver: over,
      alreadyClosed: !!(await this.prisma.surplusRun.findUnique({ where: { year: dto.year } })),
      totals: {
        members: result.memberCount,
        quotas: result.totalQuotas,
        useCents: result.totalUseCents,
        distributedCents: result.distributedCents,
      },
      shares: result.shares.map((s) => ({ ...s, name: names.get(s.userId) ?? null })),
      checksum,
    };
  }

  async close(adminId: string, dto: SurplusSimulateDto & { checksum: string }) {
    if (!isYearOver(dto.year, new Date()))
      throw new ConflictException('O ano ainda não terminou. Só dá para simular, não fechar.');
    if (await this.prisma.surplusRun.findUnique({ where: { year: dto.year } }))
      throw new ConflictException(`As sobras de ${dto.year} já foram fechadas`);
    const sim = await this.simulate(dto);
    if (sim.checksum !== dto.checksum)
      throw new ConflictException(
        'Os dados mudaram desde a simulação (ou os valores não são os simulados). Simule de novo antes de fechar.',
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const run = await tx.surplusRun.create({
          data: {
            year: dto.year,
            distributableCents: dto.distributableCents,
            useWeightPercent: sim.useWeightPercent,
            totalUseCents: sim.totals.useCents,
            totalQuotas: sim.totals.quotas,
            memberCount: sim.totals.members,
            checksum: sim.checksum,
            closedById: adminId,
            shares: {
              create: sim.shares.map((s) => ({
                userId: s.userId,
                quotas: s.quotas,
                useCents: s.useCents,
                amountCents: s.amountCents,
              })),
            },
          },
        });
        await this.ledger.post(
          tx,
          buildSurplusDistribution({
            id: randomUUID(),
            runId: run.id,
            shares: sim.shares,
            createdAt: new Date().toISOString(),
          }),
        );
        return {
          id: run.id,
          year: run.year,
          distributedCents: sim.totals.distributedCents,
          memberCount: run.memberCount,
          closedAt: run.closedAt,
        };
      });
    } catch (e) {
      // Dois fechamentos ao mesmo tempo: o segundo cai na unicidade do ano.
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException(`As sobras de ${dto.year} já foram fechadas`);
      throw e;
    }
  }

  async runs() {
    return this.prisma.surplusRun.findMany({
      orderBy: { year: 'desc' },
      select: {
        id: true,
        year: true,
        distributableCents: true,
        useWeightPercent: true,
        memberCount: true,
        totalQuotas: true,
        totalUseCents: true,
        closedAt: true,
      },
    });
  }

  /** O que o próprio sócio recebeu em cada ano fechado. */
  async mine(userId: string) {
    const rows = await this.prisma.surplusShare.findMany({
      where: { userId },
      include: { run: { select: { year: true, closedAt: true, useWeightPercent: true } } },
      orderBy: { run: { year: 'desc' } },
    });
    return rows.map((r) => ({
      year: r.run.year,
      amountCents: r.amountCents,
      quotas: r.quotas,
      useCents: r.useCents,
      useWeightPercent: r.run.useWeightPercent,
      closedAt: r.run.closedAt,
    }));
  }

  /** Uso = valor bruto das entregas/corridas concluídas no ano por cada trabalhador. */
  private async useByWorker(start: Date, end: Date, workerIds: string[]) {
    if (workerIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.delivery.groupBy({
      by: ['workerId'],
      where: {
        status: 'ENTREGUE',
        workerId: { in: workerIds },
        deliveredAt: { gte: start, lt: end },
      },
      _sum: { fareCents: true },
    });
    return new Map(rows.map((r) => [r.workerId!, r._sum.fareCents ?? 0]));
  }
}
