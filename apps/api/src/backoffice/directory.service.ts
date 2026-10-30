import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { driverApproval, type ApprovalStatus, type DocumentType } from '@amma/shared';
import { PrismaService } from '../prisma.service';
import { VERIFICATION_VIEW } from '../verification/verification.service';

/** Consultas do painel: motoristas e seus documentos, comerciantes e busca de usuários. */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Motoristas com a situação geral (derivada dos documentos, como no resto do sistema).
   * Pendentes primeiro, os mais antigos antes. O arquivo se abre por GET /admin/documents/:id/file.
   */
  async drivers(status?: ApprovalStatus, q?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        roles: { has: 'MOTORISTA' },
        deletedAt: null,
        driverProfile: { isNot: null },
        ...(q ? this.search(q) : {}),
      },
      include: {
        driverProfile: { select: { fullName: true, gender: true, genderVerifiedAt: true } },
        vehicles: { select: { id: true, type: true, plate: true, model: true, year: true } },
        documents: {
          orderBy: { createdAt: 'desc' },
          include: { verification: { select: VERIFICATION_VIEW } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const rows = users.map((u) => {
      const approval = driverApproval(
        u.documents.map((d) => ({
          type: d.type as DocumentType,
          status: d.status,
          createdAt: d.createdAt.toISOString(),
        })),
      );
      const latest = new Map<string, (typeof u.documents)[number]>();
      for (const d of u.documents) {
        const key = `${d.type}:${d.vehicleId ?? ''}`;
        if (!latest.has(key)) latest.set(key, d);
      }
      const documents = [...latest.values()].map((d) => ({
        id: d.id,
        type: d.type,
        vehicleId: d.vehicleId,
        status: d.status,
        rejectionReason: d.rejectionReason,
        createdAt: d.createdAt,
        verification: d.verification,
      }));
      return {
        userId: u.id,
        name: u.driverProfile?.fullName ?? u.name,
        phone: u.phone,
        blocked: u.blockedAt !== null,
        approval,
        genderVerified: u.driverProfile?.genderVerifiedAt != null,
        vehicles: u.vehicles,
        documents,
        pendingSince:
          documents
            .filter((d) => d.status === 'PENDENTE')
            .map((d) => d.createdAt.getTime())
            .sort((a, b) => a - b)[0] ?? null,
      };
    });
    const rank = { PENDENTE: 0, REPROVADO: 1, APROVADO: 2 } as const;
    return rows
      .filter((r) => !status || r.approval.status === status)
      .sort(
        (a, b) =>
          rank[a.approval.status] - rank[b.approval.status] ||
          (a.pendingSince ?? Infinity) - (b.pendingSince ?? Infinity),
      )
      .map(({ pendingSince, ...r }) => ({
        ...r,
        pendingSince: pendingSince ? new Date(pendingSince) : null,
      }));
  }

  async merchants(status?: ApprovalStatus) {
    const rows = await this.prisma.merchant.findMany({
      where: status ? { approvalStatus: status } : undefined,
      include: { user: { select: { name: true, phone: true, blockedAt: true } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((m) => ({
      userId: m.userId,
      tradeName: m.tradeName,
      cnpj: m.cnpj,
      address: m.address,
      ownerName: m.user.name,
      ownerPhone: m.user.phone,
      blocked: m.user.blockedAt !== null,
      status: m.approvalStatus,
      rejectionReason: m.rejectionReason,
      reviewedAt: m.reviewedAt,
      createdAt: m.createdAt,
    }));
  }

  async reviewMerchant(
    adminId: string,
    userId: string,
    status: 'APROVADO' | 'REPROVADO',
    reason?: string,
  ) {
    const why = reason?.trim();
    if (status === 'REPROVADO' && !why) throw new BadRequestException('Informe o motivo da recusa');
    const m = await this.prisma.merchant.findUnique({ where: { userId } });
    if (!m) throw new NotFoundException('Comerciante não encontrado');
    // Quem cadastrou o comércio não revisa o próprio cadastro.
    if (userId === adminId) throw new ConflictException('Você não pode revisar o próprio cadastro');
    await this.prisma.merchant.update({
      where: { userId },
      data: {
        approvalStatus: status,
        rejectionReason: status === 'REPROVADO' ? why : null,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    });
    return { userId, status };
  }

  /** Busca por nome ou telefone. Não devolve nada além do necessário para achar a pessoa. */
  async users(q?: string, blocked?: boolean) {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(q ? this.search(q) : {}),
        ...(blocked === undefined ? {} : { blockedAt: blocked ? { not: null } : null }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, name: true, phone: true, roles: true, blockedAt: true, createdAt: true },
    });
    return rows.map((u) => ({ ...u, blocked: u.blockedAt !== null }));
  }

  private search(q: string) {
    const term = q.trim();
    return term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { phone: { contains: term } },
          ],
        }
      : {};
  }
}
