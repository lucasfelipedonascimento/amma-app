import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  awardableUnits,
  buildGroupContribution,
  canJoinQueue,
  memberGroupAccount,
  rankQueue,
  type PurchaseRules,
} from '@amma/shared';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma.service';
import { ContributionDto, CreateGroupDto } from './dto';
import { MembersService } from './members.service';
import {
  InvalidPartnerWebhookError,
  PURCHASE_PARTNER,
  PartnerUnavailableError,
  type PartnerEvent,
  type PartnerResult,
  type PurchasePartner,
} from './partner';
import { PurchaseRulesService } from './purchase-rules.service';

/** UUID estável a partir de um texto: a mesma chave de idempotência dá sempre o mesmo aporte. */
function uuidFrom(text: string): string {
  const h = createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Compra coletiva de veículos. A AMMA não move dinheiro: o sócio paga ao parceiro e o aporte só vira
 * lançamento no ledger quando o parceiro CONFIRMA (na hora, por aviso assinado ou pela conciliação).
 */
@Injectable()
export class GroupPurchaseService {
  private readonly logger = new Logger('CompraColetiva');

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly rules: PurchaseRulesService,
    private readonly ledger: LedgerService,
    @Inject(PURCHASE_PARTNER) private readonly partner: PurchasePartner,
  ) {}

  // ------------------------------------------------------------------ admin

  async createGroup(adminId: string, dto: CreateGroupDto) {
    return this.prisma.purchaseGroup.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        vehicleType: dto.vehicleType,
        targetCents: dto.targetCents,
        createdById: adminId,
      },
    });
  }

  async closeGroup(id: string) {
    const r = await this.prisma.purchaseGroup.updateMany({
      where: { id, status: 'ABERTO' },
      data: { status: 'ENCERRADO' },
    });
    if (r.count === 0) await this.groupOrThrow(id);
    return { id, status: 'ENCERRADO' as const };
  }

  /**
   * Contempla o primeiro da fila (cotas + tempo), se os aportes confirmados já cobrem mais um veículo.
   * É decisão da associação (admin); o app só registra e nunca compra nada.
   */
  async award(adminId: string, groupId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Trava o grupo: duas contemplações ao mesmo tempo não usam o mesmo dinheiro duas vezes.
      await tx.$queryRaw`SELECT id FROM "PurchaseGroup" WHERE id = ${groupId} FOR UPDATE`;
      const group = await tx.purchaseGroup.findUnique({ where: { id: groupId } });
      if (!group) throw new NotFoundException('Grupo não encontrado');
      if (group.status !== 'ABERTO') throw new ConflictException('Este grupo está encerrado');
      const funded = await this.fundedCents(tx, groupId);
      const awarded = await tx.groupAward.count({ where: { groupId } });
      if (awardableUnits(funded, group.targetCents, awarded) < 1)
        throw new ConflictException('Os aportes confirmados ainda não cobrem mais um veículo');
      const rules = await this.rules.current(tx);
      const ranking = await this.ranking(tx, groupId, rules, new Date());
      const first = ranking[0];
      if (!first) throw new ConflictException('Não há ninguém apto na fila');
      const moved = await tx.queueEntry.updateMany({
        where: { id: first.entryId, status: 'NA_FILA' },
        data: { status: 'CONTEMPLADO' },
      });
      if (moved.count === 0) throw new ConflictException('A fila mudou, tente de novo');
      return tx.groupAward.create({
        data: {
          groupId,
          entryId: first.entryId,
          userId: first.userId,
          position: first.position,
          score: first.score,
          fundedCents: funded,
          awardedById: adminId,
        },
      });
    });
  }

  // ------------------------------------------------------------------ sócio

  async list(userId: string) {
    const groups = await this.prisma.purchaseGroup.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(
      groups.map(async (g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        vehicleType: g.vehicleType,
        targetCents: g.targetCents,
        status: g.status,
        fundedCents: await this.fundedCents(this.prisma, g.id),
        queueSize: await this.prisma.queueEntry.count({
          where: { groupId: g.id, status: 'NA_FILA' },
        }),
        myStatus:
          (
            await this.prisma.queueEntry.findUnique({
              where: { groupId_userId: { groupId: g.id, userId } },
            })
          )?.status ?? null,
      })),
    );
  }

  async detail(userId: string, groupId: string) {
    const group = await this.groupOrThrow(groupId);
    const now = new Date();
    const rules = await this.rules.current();
    const ranking = await this.ranking(this.prisma, groupId, rules, now);
    const funded = await this.fundedCents(this.prisma, groupId);
    const awards = await this.prisma.groupAward.findMany({
      where: { groupId },
      orderBy: { createdAt: 'asc' },
      include: { entry: { include: { user: { select: { name: true } } } } },
    });
    const mine = await this.prisma.queueEntry.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ranking.map((r) => r.userId) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      vehicleType: group.vehicleType,
      targetCents: group.targetCents,
      status: group.status,
      fundedCents: funded,
      availableUnits: awardableUnits(funded, group.targetCents, awards.length),
      rules,
      myStatus: mine?.status ?? null,
      // Só o primeiro nome dos outros sócios (LGPD); a posição e os pontos são públicos entre sócios.
      queue: ranking.map((r) => ({
        position: r.position,
        name: (names.get(r.userId) ?? 'Sócio').split(' ')[0],
        quotas: r.quotas,
        score: r.score,
        daysInQueue: Math.max(0, Math.floor((now.getTime() - r.joinedAt.getTime()) / 86_400_000)),
        isMe: r.userId === userId,
      })),
      awards: awards.map((a) => ({
        position: a.position,
        name: (a.entry.user.name ?? 'Sócio').split(' ')[0],
        awardedAt: a.createdAt,
        isMe: a.userId === userId,
      })),
    };
  }

  async join(userId: string, groupId: string) {
    const group = await this.groupOrThrow(groupId);
    if (group.status !== 'ABERTO') throw new ConflictException('Este grupo está encerrado');
    const quotas = await this.members.quotasOf(userId);
    const rules = await this.rules.current();
    if (!canJoinQueue(quotas, rules))
      throw new ForbiddenException(
        `Para entrar nesta fila é preciso ter ao menos ${Math.max(rules.minQuotas, 1)} cota(s). Você tem ${quotas}.`,
      );
    const existing = await this.prisma.queueEntry.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing && existing.status !== 'DESISTIU')
      throw new ConflictException(
        existing.status === 'CONTEMPLADO'
          ? 'Você já foi contemplado neste grupo'
          : 'Você já está nesta fila',
      );
    // Quem sai e volta recomeça o tempo de fila: o tempo é de quem ficou.
    const entry = existing
      ? await this.prisma.queueEntry.update({
          where: { id: existing.id },
          data: { status: 'NA_FILA', joinedAt: new Date(), leftAt: null },
        })
      : await this.prisma.queueEntry.create({ data: { groupId, userId } });
    return this.detail(userId, groupId).then((d) => ({ ...d, joinedAt: entry.joinedAt }));
  }

  async leave(userId: string, groupId: string) {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!entry || entry.status === 'DESISTIU')
      throw new NotFoundException('Você não está nesta fila');
    if (entry.status === 'CONTEMPLADO')
      throw new ConflictException(
        'Quem foi contemplado não sai da fila por aqui. Fale com a associação.',
      );
    const paid = await this.prisma.contribution.count({
      where: { groupId, userId, status: { in: ['CONFIRMADO', 'PENDENTE'] } },
    });
    if (paid > 0)
      throw new ConflictException(
        'Você já tem aportes neste grupo. A devolução é combinada com a associação e o parceiro.',
      );
    await this.prisma.queueEntry.update({
      where: { id: entry.id },
      data: { status: 'DESISTIU', leftAt: new Date() },
    });
    return { groupId, status: 'DESISTIU' as const };
  }

  /** Aporte: o parceiro aceita primeiro; só então grava o registro e o ledger, juntos. */
  async contribute(userId: string, groupId: string, dto: ContributionDto) {
    const group = await this.groupOrThrow(groupId);
    if (group.status !== 'ABERTO') throw new ConflictException('Este grupo está encerrado');
    const id = dto.idempotencyKey
      ? uuidFrom(`${userId}|${groupId}|${dto.idempotencyKey}`)
      : randomUUID();
    const existing = await this.prisma.contribution.findUnique({ where: { id } });
    if (existing) return this.contributionView(existing);
    const entry = await this.prisma.queueEntry.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!entry || entry.status === 'DESISTIU')
      throw new ForbiddenException('Entre na fila do grupo antes de fazer um aporte');
    const rules = await this.rules.current();
    if (dto.amountCents < rules.minContributionCents)
      throw new BadRequestException(
        `O aporte mínimo é de ${(rules.minContributionCents / 100).toFixed(2).replace('.', ',')} reais`,
      );

    let result: PartnerResult;
    try {
      result = await this.partner.registerContribution({
        reference: id,
        groupId,
        userId,
        amountCents: dto.amountCents,
      });
    } catch (e) {
      if (e instanceof PartnerUnavailableError)
        throw new ServiceUnavailableException(
          'O parceiro está indisponível. Nada foi registrado; tente de novo.',
        );
      throw e;
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const c = await tx.contribution.create({
          data: {
            id,
            groupId,
            userId,
            amountCents: dto.amountCents,
            status: result.status,
            partner: this.partner.name,
            partnerRef: result.status === 'RECUSADO' ? null : result.partnerRef,
            declineReason: result.status === 'RECUSADO' ? result.reason : null,
            instructions: result.status === 'PENDENTE' ? (result.instructions ?? null) : null,
            confirmedAt: result.status === 'CONFIRMADO' ? new Date() : null,
            idempotencyKey: dto.idempotencyKey,
          },
        });
        if (result.status === 'CONFIRMADO') await this.postToLedger(tx, c);
        return c;
      });
      return this.contributionView(row);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const again = await this.prisma.contribution.findUnique({ where: { id } });
        if (again) return this.contributionView(again);
      }
      throw e;
    }
  }

  // ------------------------------------------------------------------ parceiro (confirmação assíncrona)

  /** Aviso do parceiro (webhook). A assinatura vem validada pelo parceiro; sem ela, 401 e nada muda. */
  async handlePartnerWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    let event: PartnerEvent | null;
    try {
      event = this.partner.parseWebhook(rawBody, headers);
    } catch (e) {
      if (e instanceof InvalidPartnerWebhookError) throw new UnauthorizedException();
      throw e;
    }
    if (event) await this.handlePartnerEvent(event);
    return { received: true };
  }

  /**
   * Trata um aviso já validado. Idempotente por (parceiro, eventId): o parceiro reenvia avisos, e
   * repetir não pode lançar o aporte duas vezes.
   */
  async handlePartnerEvent(e: PartnerEvent): Promise<void> {
    const key = { partner: this.partner.name, eventId: e.eventId };
    try {
      await this.prisma.partnerWebhookEvent.create({ data: { ...key, type: e.outcome } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return;
      throw err;
    }
    try {
      await this.applyOutcome(
        e.partnerRef,
        e.outcome === 'CONFIRMADO'
          ? { status: 'CONFIRMADO', partnerRef: e.partnerRef }
          : { status: 'RECUSADO', reason: e.reason ?? 'Recusado pelo parceiro' },
      );
    } catch (err) {
      // Falha nossa: apaga o registro para o parceiro poder reenviar e tentarmos de novo.
      await this.prisma.partnerWebhookEvent.deleteMany({ where: key }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Conciliação: pergunta ao parceiro pelos aportes PENDENTES parados há mais de `olderThanMs`.
   * Cobre o aviso que se perdeu. Não lança: um aporte com problema não trava os demais.
   */
  async reconcilePending(olderThanMs = 5 * 60_000, limit = 50): Promise<number> {
    const rows = await this.prisma.contribution.findMany({
      where: {
        status: 'PENDENTE',
        partner: this.partner.name,
        partnerRef: { not: null },
        createdAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let resolved = 0;
    for (const row of rows) {
      try {
        const r = await this.partner.fetchContribution(row.partnerRef!);
        if (r.status === 'PENDENTE') continue;
        if (await this.applyOutcome(row.partnerRef!, r)) resolved++;
      } catch (err) {
        this.logger.warn(`Conciliação do aporte ${row.id} falhou: ${(err as Error).message}`);
      }
    }
    return resolved;
  }

  /**
   * Muda um aporte PENDENTE para o resultado final, uma vez só (a troca de status é condicional e o
   * lançamento no ledger vai na mesma transação). Aporte que já estava decidido é ignorado.
   */
  private async applyOutcome(partnerRef: string, r: PartnerResult): Promise<boolean> {
    if (r.status === 'PENDENTE') return false;
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.contribution.findUnique({
        where: { partner_partnerRef: { partner: this.partner.name, partnerRef } },
      });
      if (!c) {
        // Aporte que não conhecemos: registra e segue (reenviar o aviso não adianta).
        this.logger.warn(`Aviso do parceiro para aporte desconhecido ${partnerRef}`);
        return false;
      }
      if (c.status !== 'PENDENTE') {
        if (c.status !== r.status)
          this.logger.warn(`Parceiro diz ${r.status}, mas o aporte ${c.id} já está ${c.status}`);
        return false;
      }
      const moved = await tx.contribution.updateMany({
        where: { id: c.id, status: 'PENDENTE' },
        data:
          r.status === 'CONFIRMADO'
            ? { status: 'CONFIRMADO', confirmedAt: new Date(), instructions: null }
            : { status: 'RECUSADO', declineReason: r.reason, instructions: null },
      });
      if (moved.count === 0) return false;
      if (r.status === 'CONFIRMADO') await this.postToLedger(tx, c);
      return true;
    });
  }

  private postToLedger(
    tx: Prisma.TransactionClient,
    c: { id: string; groupId: string; userId: string; amountCents: number },
  ) {
    return this.ledger.post(
      tx,
      buildGroupContribution({
        id: randomUUID(),
        contributionId: c.id,
        groupId: c.groupId,
        userId: c.userId,
        amountCents: c.amountCents,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  async myContributions(userId: string, groupId: string) {
    await this.groupOrThrow(groupId);
    const rows = await this.prisma.contribution.findMany({
      where: { groupId, userId },
      orderBy: { createdAt: 'desc' },
    });
    const totalCents = await this.ledger.creditBalance(memberGroupAccount(groupId, userId));
    return { totalCents, items: rows.map((r) => this.contributionView(r)) };
  }

  // ------------------------------------------------------------------ internos

  private contributionView(c: {
    id: string;
    groupId: string;
    amountCents: number;
    status: string;
    declineReason: string | null;
    instructions: string | null;
    partner: string;
    createdAt: Date;
  }) {
    return {
      id: c.id,
      groupId: c.groupId,
      amountCents: c.amountCents,
      status: c.status,
      declineReason: c.declineReason,
      // Só enquanto aguarda o pagamento ao parceiro.
      instructions: c.status === 'PENDENTE' ? c.instructions : null,
      partner: c.partner,
      createdAt: c.createdAt,
    };
  }

  private async groupOrThrow(id: string) {
    const g = await this.prisma.purchaseGroup.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Grupo não encontrado');
    return g;
  }

  private async fundedCents(db: Prisma.TransactionClient | PrismaService, groupId: string) {
    const r = await db.contribution.aggregate({
      where: { groupId, status: 'CONFIRMADO' },
      _sum: { amountCents: true },
    });
    return r._sum.amountCents ?? 0;
  }

  /** Fila de quem está NA_FILA e ainda é apto (sócio com as cotas mínimas), ordenada pelas regras. */
  private async ranking(
    db: Prisma.TransactionClient | PrismaService,
    groupId: string,
    rules: PurchaseRules,
    now: Date,
  ) {
    const entries = await db.queueEntry.findMany({ where: { groupId, status: 'NA_FILA' } });
    const quotas = await this.members.listMembers();
    const eligible = entries.filter((e) => canJoinQueue(quotas.get(e.userId) ?? 0, rules));
    const entryOf = new Map(eligible.map((e) => [e.userId, e.id]));
    return rankQueue(
      eligible.map((e) => ({
        userId: e.userId,
        quotas: quotas.get(e.userId)!,
        joinedAt: e.joinedAt,
      })),
      now,
      rules,
    ).map((r) => ({ ...r, entryId: entryOf.get(r.userId)! }));
  }
}
