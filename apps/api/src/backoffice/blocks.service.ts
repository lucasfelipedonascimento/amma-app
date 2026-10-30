import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  APPEAL_TEXT_MAX,
  APPEAL_TEXT_MIN,
  BLOCK_REASON_MAX,
  BLOCK_REASON_MIN,
  appealDeadline,
  canAppeal,
  canBlockUser,
  canDecideAppeal,
  canRevoke,
  statusAfterAppeal,
  validateReason,
  type AppealDecision,
  type BlockStatus,
} from '@amma/shared';
import { Prisma, type AccountBlock } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const bad = (msg: string | null) => {
  if (msg) throw new BadRequestException(msg);
};

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Visão completa do bloqueio (admin). */
  private adminView(b: AccountBlock & { user?: { name: string | null; phone: string | null } }) {
    return {
      id: b.id,
      userId: b.userId,
      userName: b.user?.name ?? null,
      userPhone: b.user?.phone ?? null,
      status: b.status,
      reason: b.reason,
      blockedById: b.blockedById,
      blockedAt: b.blockedAt,
      appealDeadline: appealDeadline(b.blockedAt),
      appealText: b.appealText,
      appealedAt: b.appealedAt,
      decidedById: b.decidedById,
      decidedAt: b.decidedAt,
      decisionReason: b.decisionReason,
      revokedById: b.revokedById,
      revokedAt: b.revokedAt,
      revokeReason: b.revokeReason,
    };
  }

  /** Bloqueia a conta, com motivo. Tira o motorista do ar e recusa novas ofertas (ver dispatch). */
  async block(adminId: string, userId: string, reason: string) {
    bad(validateReason(reason, BLOCK_REASON_MIN, BLOCK_REASON_MAX));
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.deletedAt) throw new NotFoundException('Usuário não encontrado');
    if (!canBlockUser(target, adminId))
      throw new ForbiddenException('Não é possível bloquear a si mesmo nem outro administrador');
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const b = await tx.accountBlock.create({
          data: { userId, reason: reason.trim(), blockedById: adminId },
          include: { user: { select: { name: true, phone: true } } },
        });
        await tx.user.update({ where: { id: userId }, data: { blockedAt: b.blockedAt } });
        await tx.driverPresence.updateMany({ where: { userId }, data: { online: false } });
        return b;
      });
      return this.adminView(created);
    } catch (e) {
      // Índice único parcial: já existe bloqueio em vigor.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Esta conta já está bloqueada');
      throw e;
    }
  }

  async revoke(adminId: string, blockId: string, reason: string) {
    bad(validateReason(reason, BLOCK_REASON_MIN, BLOCK_REASON_MAX));
    const b = await this.getOrThrow(blockId);
    if (!canRevoke(b.status as BlockStatus)) throw new ConflictException('Bloqueio já revogado');
    return this.finish(b, {
      status: 'REVOGADO',
      revokedById: adminId,
      revokedAt: new Date(),
      revokeReason: reason.trim(),
    });
  }

  /** Decide o recurso. Quem aplicou o bloqueio não decide (segunda opinião). */
  async decideAppeal(adminId: string, blockId: string, decision: AppealDecision, reason: string) {
    bad(validateReason(reason, BLOCK_REASON_MIN, BLOCK_REASON_MAX));
    const b = await this.getOrThrow(blockId);
    if (b.status !== 'EM_RECURSO') throw new ConflictException('Não há recurso em análise');
    if (!canDecideAppeal(b.blockedById, adminId))
      throw new ForbiddenException('Quem aplicou o bloqueio não decide o recurso');
    return this.finish(b, {
      status: statusAfterAppeal(decision),
      decidedById: adminId,
      decidedAt: new Date(),
      decisionReason: reason.trim(),
    });
  }

  /** Atualiza o bloqueio e a cópia em User na mesma transação; condição no status evita decisão dupla. */
  private async finish(b: AccountBlock, data: Prisma.AccountBlockUncheckedUpdateManyInput) {
    const out = await this.prisma.$transaction(async (tx) => {
      const r = await tx.accountBlock.updateMany({ where: { id: b.id, status: b.status }, data });
      if (r.count === 0) throw new ConflictException('O bloqueio mudou; recarregue a página');
      if (data.status === 'REVOGADO')
        await tx.user.update({ where: { id: b.userId }, data: { blockedAt: null } });
      return tx.accountBlock.findUniqueOrThrow({
        where: { id: b.id },
        include: { user: { select: { name: true, phone: true } } },
      });
    });
    return this.adminView(out);
  }

  private async getOrThrow(id: string) {
    const b = await this.prisma.accountBlock.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Bloqueio não encontrado');
    return b;
  }

  /** Lista para o admin. Padrão: recursos esperando decisão, do mais antigo (fila). */
  async list(status?: BlockStatus, userId?: string) {
    const rows = await this.prisma.accountBlock.findMany({
      where: { ...(status ? { status } : {}), ...(userId ? { userId } : {}) },
      orderBy: { blockedAt: status === 'EM_RECURSO' ? 'asc' : 'desc' },
      take: 200,
      include: { user: { select: { name: true, phone: true } } },
    });
    return rows.map((b) => this.adminView(b));
  }

  // ------------------------------------------------------------------ a própria pessoa

  /** O bloqueio mais recente da pessoa: motivo, prazo para recorrer e andamento do recurso. */
  async mine(userId: string) {
    const b = await this.prisma.accountBlock.findFirst({
      where: { userId },
      orderBy: { blockedAt: 'desc' },
    });
    if (!b) return { blocked: false as const };
    const check = canAppeal({ status: b.status, blockedAt: b.blockedAt }, new Date());
    return {
      blocked: b.status !== 'REVOGADO',
      id: b.id,
      status: b.status,
      reason: b.reason,
      blockedAt: b.blockedAt,
      appealDeadline: appealDeadline(b.blockedAt),
      canAppeal: check.ok,
      cannotAppealReason: check.ok ? null : check.reason,
      appealText: b.appealText,
      appealedAt: b.appealedAt,
      decisionReason:
        b.status === 'MANTIDO' || b.status === 'REVOGADO'
          ? (b.decisionReason ?? b.revokeReason)
          : null,
      decidedAt: b.decidedAt ?? b.revokedAt,
    };
  }

  async appeal(userId: string, text: string) {
    bad(validateReason(text, APPEAL_TEXT_MIN, APPEAL_TEXT_MAX));
    const b = await this.prisma.accountBlock.findFirst({
      where: { userId, status: { not: 'REVOGADO' } },
    });
    if (!b) throw new NotFoundException('Você não tem bloqueio em vigor');
    const check = canAppeal({ status: b.status, blockedAt: b.blockedAt }, new Date());
    if (!check.ok) throw new ConflictException(check.reason);
    const r = await this.prisma.accountBlock.updateMany({
      where: { id: b.id, status: 'ATIVO' },
      data: { status: 'EM_RECURSO', appealText: text.trim(), appealedAt: new Date() },
    });
    if (r.count === 0) throw new ConflictException('O recurso já foi enviado');
    return this.mine(userId);
  }
}
