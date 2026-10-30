import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export interface AuditQuery {
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  before?: string;
  limit: number;
}

/** Trilha de auditoria: só inserção (o banco recusa editar/apagar). */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    actorId: string;
    action: string;
    params: Record<string, string>;
    reason?: string | null;
    ip?: string | null;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          params: entry.params,
          reason: entry.reason ?? null,
          ip: entry.ip ?? null,
        },
      });
    } catch (e) {
      // A ação já aconteceu; não dá para desfazê-la aqui. Fica no log do servidor para alguém ver.
      this.log.error(`Falha ao gravar auditoria de ${entry.action} por ${entry.actorId}: ${e}`);
    }
  }

  /** Mais recentes primeiro; `before` é o id do último item da página anterior. */
  async list(q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...((q.from ?? q.to) ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
      include: { actor: { select: { name: true, phone: true } } },
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.createdAt,
        actorId: r.actorId,
        actorName: r.actor.name,
        action: r.action,
        params: r.params,
        reason: r.reason,
        ip: r.ip,
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
    };
  }

  /** Ações já registradas (para o filtro do painel). */
  async actions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }
}
