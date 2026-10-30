import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  POINT_SEVERE_REPORT_CATEGORIES,
  SUSPEND_REASON_TEXT,
  ratingSummary,
  suspensionReason,
  type PointStatus,
} from '@amma/shared';
import { Prisma, type WelcomePoint } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ApprovePointDto, PointReportDto, ResolveReportDto } from './dto';
import type { Viewer } from './points.service';

const REPORTS_PER_DAY = 5;

/**
 * Denúncia, suspensão automática e decisões do admin sobre os pontos. A máquina é simples:
 * EM_ANALISE → ATIVO | RECUSADO;  ATIVO ⇄ SUSPENSO;  qualquer um vivo → REMOVIDO.
 * Quem decide é sempre uma pessoa da associação, com motivo, e tudo vira linha do tempo imutável.
 */
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ denúncia

  async report(user: Viewer, pointId: string, dto: PointReportDto) {
    const point = await this.prisma.welcomePoint.findUnique({ where: { id: pointId } });
    if (!point || !['ATIVO', 'SUSPENSO'].includes(point.status))
      throw new NotFoundException('Ponto não encontrado');
    if (point.ownerId === user.id)
      throw new ForbiddenException('Você não pode denunciar o seu próprio ponto');
    const today = await this.prisma.pointReport.count({
      where: { reporterId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    if (today >= REPORTS_PER_DAY)
      throw new ConflictException('Limite de denúncias por dia atingido. Tente amanhã.');
    try {
      const r = await this.prisma.pointReport.create({
        data: {
          pointId,
          reporterId: user.id,
          category: dto.category,
          text: dto.text?.trim() || null,
        },
      });
      await this.review(pointId);
      return this.reportView(r);
    } catch (e) {
      // Índice parcial: uma denúncia aberta por pessoa em cada ponto.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Você já tem uma denúncia aberta sobre este ponto');
      throw e;
    }
  }

  /** Quem denunciou vê só a situação e a resposta da associação. */
  async mine(user: Viewer) {
    const rows = await this.prisma.pointReport.findMany({
      where: { reporterId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { point: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...this.reportView(r), pointName: r.point.name }));
  }

  /**
   * Tira o ponto do mapa se as avaliações ou as denúncias abertas pedirem. Roda a cada nova nota e
   * denúncia. Só suspende (nunca remove): a decisão final é do admin.
   */
  async review(pointId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WelcomePoint" WHERE id = ${pointId} FOR UPDATE`;
      const point = await tx.welcomePoint.findUnique({ where: { id: pointId } });
      if (!point || point.status !== 'ATIVO') return;
      const [ratings, reports] = await Promise.all([
        tx.pointRating.findMany({
          where: { direction: 'VISITANTE_AVALIA_PONTO', checkIn: { pointId } },
          select: { stars: true },
        }),
        tx.pointReport.findMany({
          where: { pointId, status: 'ABERTA' },
          select: { reporterId: true, category: true },
        }),
      ]);
      const reason = suspensionReason({ stars: ratings.map((r) => r.stars), openReports: reports });
      if (!reason) return;
      const note = SUSPEND_REASON_TEXT[reason];
      await tx.welcomePoint.update({
        where: { id: pointId },
        data: { status: 'SUSPENSO', statusNote: note },
      });
      await tx.pointEvent.create({
        data: { pointId, actorId: null, fromStatus: 'ATIVO', toStatus: 'SUSPENSO', note },
      });
      // Quem estava lá é liberado: o ponto saiu do ar.
      await tx.checkIn.updateMany({
        where: { pointId, endedAt: null },
        data: { endedAt: new Date() },
      });
    });
  }

  // ------------------------------------------------------------------ admin: pontos

  async listPoints(status?: string) {
    const rows = await this.prisma.welcomePoint.findMany({
      where: status ? { status: status as PointStatus } : undefined,
      orderBy: { createdAt: 'asc' },
      include: {
        owner: { select: { id: true, name: true, phone: true } },
        _count: { select: { reports: { where: { status: 'ABERTA' } } } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      type: p.type,
      status: p.status,
      name: p.name,
      neighborhood: p.neighborhood,
      statusNote: p.statusNote,
      createdAt: p.createdAt,
      owner: p.owner,
      openReports: p._count.reports,
    }));
  }

  async getPoint(id: string) {
    const p = await this.prisma.welcomePoint.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, phone: true } },
        photos: { select: { id: true } },
        events: { orderBy: { createdAt: 'asc' } },
        reports: {
          orderBy: { createdAt: 'desc' },
          include: { reporter: { select: { id: true, name: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Ponto não encontrado');
    const ratings = await this.prisma.pointRating.findMany({
      where: { checkIn: { pointId: id } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { direction: true, stars: true, comment: true, createdAt: true },
    });
    const pointStars = ratings
      .filter((r) => r.direction === 'VISITANTE_AVALIA_PONTO')
      .map((r) => r.stars);
    const { events, reports, ...rest } = p;
    return {
      ...rest,
      rating: ratingSummary(pointStars),
      // Para o admin, a média vale mesmo com poucas notas.
      ratingCount: pointStars.length,
      ratings,
      events,
      reports: reports.map((r) => ({ ...this.reportView(r), reporter: r.reporter, text: r.text })),
    };
  }

  /** Aprova a casa parceira: só depois de conferir o anfitrião e o local. Não vale para o próprio cadastro. */
  async approve(admin: Viewer, id: string, dto: ApprovePointDto) {
    if (!dto.identityChecked || !dto.placeChecked)
      throw new BadRequestException('Confirme que conferiu a identidade do anfitrião e o local');
    return this.move(
      admin,
      id,
      ['EM_ANALISE'],
      'ATIVO',
      dto.note?.trim() || 'Aprovado pela associação',
    );
  }

  refuse(admin: Viewer, id: string, note: string) {
    return this.move(admin, id, ['EM_ANALISE'], 'RECUSADO', note);
  }

  /** Remove um ponto mal avaliado ou denunciado. Libera quem estava lá. */
  remove(admin: Viewer, id: string, note: string) {
    return this.move(admin, id, ['EM_ANALISE', 'ATIVO', 'SUSPENSO'], 'REMOVIDO', note);
  }

  /** Devolve ao mapa um ponto suspenso — só sem denúncias abertas. */
  async reinstate(admin: Viewer, id: string, note: string) {
    const open = await this.prisma.pointReport.count({ where: { pointId: id, status: 'ABERTA' } });
    if (open > 0)
      throw new ConflictException('Resolva as denúncias abertas deste ponto antes de reativá-lo');
    return this.move(admin, id, ['SUSPENSO'], 'ATIVO', note);
  }

  // ------------------------------------------------------------------ admin: denúncias

  async listReports(status?: string) {
    const rows = await this.prisma.pointReport.findMany({
      where: { status: (status ?? 'ABERTA') as 'ABERTA' | 'PROCEDENTE' | 'IMPROCEDENTE' },
      include: {
        point: { select: { id: true, name: true, status: true, type: true } },
        reporter: { select: { id: true, name: true } },
      },
    });
    const severe = (c: string) => (POINT_SEVERE_REPORT_CATEGORIES as readonly string[]).includes(c);
    // Graves primeiro; dentro de cada grupo, as mais antigas.
    return rows
      .sort(
        (a, b) =>
          Number(severe(b.category)) - Number(severe(a.category)) || +a.createdAt - +b.createdAt,
      )
      .map((r) => ({
        ...this.reportView(r),
        text: r.text,
        severe: severe(r.category),
        point: r.point,
        reporter: r.reporter,
      }));
  }

  async resolveReport(admin: Viewer, id: string, dto: ResolveReportDto) {
    const r = await this.prisma.pointReport.findUnique({ where: { id }, include: { point: true } });
    if (!r) throw new NotFoundException('Denúncia não encontrada');
    if (r.point.ownerId === admin.id)
      throw new ForbiddenException('Você não decide denúncia sobre o seu próprio ponto');
    if (dto.removePoint && dto.outcome !== 'PROCEDENTE')
      throw new BadRequestException('Só uma denúncia procedente pode remover o ponto');
    const res = await this.prisma.pointReport.updateMany({
      where: { id, status: 'ABERTA' },
      data: {
        status: dto.outcome,
        resolvedById: admin.id,
        resolvedAt: new Date(),
        response: dto.response.trim(),
      },
    });
    if (res.count === 0) throw new ConflictException('Esta denúncia já foi resolvida');
    if (dto.removePoint && ['EM_ANALISE', 'ATIVO', 'SUSPENSO'].includes(r.point.status))
      await this.move(
        admin,
        r.pointId,
        ['EM_ANALISE', 'ATIVO', 'SUSPENSO'],
        'REMOVIDO',
        dto.response.trim(),
      );
    return this.reportView(await this.prisma.pointReport.findUniqueOrThrow({ where: { id } }));
  }

  // ------------------------------------------------------------------ comum

  /** Muda o status com trava, evento e motivo. Quem cadastrou não decide o próprio ponto. */
  private async move(
    admin: Viewer,
    id: string,
    from: PointStatus[],
    to: PointStatus,
    note: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WelcomePoint" WHERE id = ${id} FOR UPDATE`;
      const p: WelcomePoint | null = await tx.welcomePoint.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Ponto não encontrado');
      if (p.ownerId === admin.id)
        throw new ForbiddenException('Você não decide sobre o seu próprio ponto');
      if (!from.includes(p.status))
        throw new ConflictException(`Um ponto "${p.status}" não pode ir para "${to}"`);
      await tx.welcomePoint.update({
        where: { id },
        data: { status: to, statusNote: note, decidedById: admin.id, decidedAt: new Date() },
      });
      await tx.pointEvent.create({
        data: { pointId: id, actorId: admin.id, fromStatus: p.status, toStatus: to, note },
      });
      if (to === 'REMOVIDO' || to === 'RECUSADO')
        await tx.checkIn.updateMany({
          where: { pointId: id, endedAt: null },
          data: { endedAt: new Date() },
        });
      return { id, status: to, statusNote: note };
    });
  }

  private reportView(r: {
    id: string;
    pointId: string;
    category: string;
    status: string;
    response: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }) {
    return {
      id: r.id,
      pointId: r.pointId,
      category: r.category,
      status: r.status,
      response: r.response,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    };
  }
}
