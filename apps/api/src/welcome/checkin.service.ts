import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CHECKIN_COOLDOWN_MINUTES,
  CHECKIN_MAX_MINUTES,
  CHECKIN_MIN_MINUTES,
  CHECKIN_RADIUS_METERS,
  buildHostBenefit,
  earnsHostBenefit,
  hasHost,
  haversineMeters,
  hostBenefitCents,
  isOpenAt,
  ratingSummary,
  startOfMonthJoaoPessoa,
  type OpeningHours,
} from '@amma/shared';
import { Prisma, type CheckIn } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma.service';
import { CheckInDto, PointRatingDto } from './dto';
import { closeExpiredCheckIns } from './expiry';
import { ModerationService } from './moderation.service';
import { PointsService, type Viewer } from './points.service';

const RATE_WINDOW_MS = 7 * 86_400_000;
const VISITS_WINDOW_MS = 30 * 86_400_000;

/** Check-in do motorista num ponto, saída (com o benefício do anfitrião) e avaliação dos dois lados. */
@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly moderation: ModerationService,
    private readonly ledger: LedgerService,
  ) {}

  async checkIn(user: Viewer, pointId: string, dto: CheckInDto) {
    await closeExpiredCheckIns(this.prisma);
    const point = await this.prisma.welcomePoint.findUnique({ where: { id: pointId } });
    if (!point || point.status !== 'ATIVO') throw new NotFoundException('Ponto não encontrado');
    if (point.ownerId === user.id)
      throw new ForbiddenException('Você é o anfitrião deste ponto e não pode fazer check-in nele');
    if (!isOpenAt(point.hours as unknown as OpeningHours, new Date()))
      throw new ConflictException('Este ponto está fechado agora');
    const distance = haversineMeters({ lat: dto.lat, lng: dto.lng }, point);
    if (distance > CHECKIN_RADIUS_METERS)
      throw new ConflictException(
        `Você precisa estar a até ${CHECKIN_RADIUS_METERS} m do ponto para fazer check-in (está a ${distance} m)`,
      );
    const open = await this.prisma.checkIn.findFirst({ where: { userId: user.id, endedAt: null } });
    if (open)
      throw new ConflictException(
        'Você já está com um check-in aberto. Encerre-o antes de entrar em outro.',
      );
    const last = await this.prisma.checkIn.findFirst({
      where: {
        userId: user.id,
        pointId,
        startedAt: { gt: new Date(Date.now() - CHECKIN_COOLDOWN_MINUTES * 60_000) },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (last)
      throw new ConflictException(
        `Você já esteve aqui há pouco. Novo check-in neste ponto só depois de ${CHECKIN_COOLDOWN_MINUTES / 60} horas.`,
      );

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Trava o ponto: dois motoristas chegando juntos não passam da capacidade.
        await tx.$queryRaw`SELECT id FROM "WelcomePoint" WHERE id = ${pointId} FOR UPDATE`;
        const occupied = await tx.checkIn.count({ where: { pointId, endedAt: null } });
        if (occupied >= point.capacity) throw new ConflictException('Este ponto está lotado agora');
        return tx.checkIn.create({
          data: { pointId, userId: user.id, distanceMeters: distance },
        });
      });
      return { checkIn: this.checkInView(created), point: await this.points.get(user, pointId) };
    } catch (e) {
      // Índice único: um check-in aberto por pessoa (duplo toque / duas abas).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Você já está com um check-in aberto');
      throw e;
    }
  }

  /** O check-in aberto de quem pede, com o ponto (endereço completo incluso). */
  async active(user: Viewer) {
    await closeExpiredCheckIns(this.prisma);
    const c = await this.prisma.checkIn.findFirst({ where: { userId: user.id, endedAt: null } });
    if (!c) return { checkIn: null, point: null };
    return { checkIn: this.checkInView(c), point: await this.points.get(user, c.pointId) };
  }

  /** Histórico do próprio motorista (para avaliar visitas encerradas). */
  async history(user: Viewer) {
    const rows = await this.prisma.checkIn.findMany({
      where: { userId: user.id, endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 30,
      include: {
        point: { select: { id: true, name: true, type: true, neighborhood: true } },
        ratings: { where: { direction: 'VISITANTE_AVALIA_PONTO' }, select: { id: true } },
      },
    });
    const now = Date.now();
    return rows.map((c) => ({
      ...this.checkInView(c),
      point: c.point,
      rated: c.ratings.length > 0,
      canRate:
        c.completed && c.ratings.length === 0 && now - c.endedAt!.getTime() <= RATE_WINDOW_MS,
    }));
  }

  /** Sai do ponto. Ficando o mínimo, a visita conta e, na casa parceira, o anfitrião recebe o benefício. */
  async end(user: Viewer, checkInId: string) {
    await closeExpiredCheckIns(this.prisma);
    const c = await this.prisma.checkIn.findUnique({
      where: { id: checkInId },
      include: { point: true },
    });
    if (!c || c.userId !== user.id) throw new NotFoundException('Check-in não encontrado');
    if (c.endedAt) throw new ConflictException('Este check-in já foi encerrado');

    const now = new Date();
    const minutes = Math.floor((now.getTime() - c.startedAt.getTime()) / 60_000);
    const counts = minutes >= CHECKIN_MIN_MINUTES && minutes <= CHECKIN_MAX_MINUTES;

    const done = await this.prisma.$transaction(async (tx) => {
      // Trava o ponto: o teto do mês é lido e usado sem outra saída passar na frente.
      await tx.$queryRaw`SELECT id FROM "WelcomePoint" WHERE id = ${c.pointId} FOR UPDATE`;
      let benefitCents = 0;
      if (counts && earnsHostBenefit(c.point.type) && c.point.status !== 'REMOVIDO') {
        const earned = await tx.checkIn.aggregate({
          where: { pointId: c.pointId, endedAt: { gte: startOfMonthJoaoPessoa(now) } },
          _sum: { benefitCents: true },
        });
        benefitCents = hostBenefitCents(earned._sum.benefitCents ?? 0);
      }
      // Só um encerramento vence (duplo toque).
      const res = await tx.checkIn.updateMany({
        where: { id: checkInId, endedAt: null },
        data: { endedAt: now, completed: counts, benefitCents },
      });
      if (res.count === 0) throw new ConflictException('Este check-in já foi encerrado');
      if (benefitCents > 0)
        await this.ledger.post(
          tx,
          buildHostBenefit({
            id: randomUUID(),
            checkInId,
            hostId: c.point.ownerId,
            kind: c.point.benefitKind,
            amountCents: benefitCents,
            createdAt: now.toISOString(),
          }),
        );
      return tx.checkIn.findUniqueOrThrow({ where: { id: checkInId } });
    });
    return { ...this.checkInView(done), canRate: done.completed };
  }

  // ------------------------------------------------------------------ avaliação dos dois lados

  /** O visitante avalia o ponto (uma vez por visita que contou, até 7 dias depois). */
  async ratePoint(user: Viewer, checkInId: string, dto: PointRatingDto) {
    const c = await this.prisma.checkIn.findUnique({ where: { id: checkInId } });
    if (!c || c.userId !== user.id) throw new NotFoundException('Visita não encontrada');
    this.assertRatable(c);
    await this.createRating(checkInId, 'VISITANTE_AVALIA_PONTO', user.id, dto);
    await this.moderation.review(c.pointId);
    return { ok: true };
  }

  /** O anfitrião avalia o visitante (só pontos com anfitrião, só visitas que contaram). */
  async rateVisitor(user: Viewer, checkInId: string, dto: PointRatingDto) {
    const c = await this.prisma.checkIn.findUnique({
      where: { id: checkInId },
      include: { point: true },
    });
    if (!c || c.point.ownerId !== user.id) throw new NotFoundException('Visita não encontrada');
    if (!hasHost(c.point.type))
      throw new ForbiddenException('Espaço público não tem anfitrião para avaliar visitantes');
    this.assertRatable(c);
    await this.createRating(checkInId, 'ANFITRIAO_AVALIA_VISITANTE', user.id, dto);
    return { ok: true };
  }

  /** Visitas recentes ao ponto, para o anfitrião avaliar. Mostra só primeiro nome e a média do visitante. */
  async visits(user: Viewer, pointId: string) {
    const point = await this.prisma.welcomePoint.findUnique({ where: { id: pointId } });
    if (!point || point.ownerId !== user.id) throw new NotFoundException('Ponto não encontrado');
    await closeExpiredCheckIns(this.prisma);
    const rows = await this.prisma.checkIn.findMany({
      where: {
        pointId,
        completed: true,
        endedAt: { gte: new Date(Date.now() - VISITS_WINDOW_MS) },
      },
      orderBy: { endedAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, name: true } },
        ratings: { where: { direction: 'ANFITRIAO_AVALIA_VISITANTE' }, select: { id: true } },
      },
    });
    const received = await this.prisma.pointRating.findMany({
      where: {
        direction: 'ANFITRIAO_AVALIA_VISITANTE',
        checkIn: { userId: { in: [...new Set(rows.map((r) => r.userId))] } },
      },
      select: { stars: true, checkIn: { select: { userId: true } } },
    });
    const byVisitor = new Map<string, number[]>();
    for (const r of received) {
      const list = byVisitor.get(r.checkIn.userId) ?? [];
      list.push(r.stars);
      byVisitor.set(r.checkIn.userId, list);
    }
    return rows.map((c) => ({
      id: c.id,
      endedAt: c.endedAt,
      minutes: Math.floor((c.endedAt!.getTime() - c.startedAt.getTime()) / 60_000),
      visitorName: (c.user.name ?? 'Motorista').split(' ')[0],
      visitorRating: ratingSummary(byVisitor.get(c.userId) ?? []),
      rated: c.ratings.length > 0,
      canRate: c.ratings.length === 0 && Date.now() - c.endedAt!.getTime() <= RATE_WINDOW_MS,
    }));
  }

  private assertRatable(c: CheckIn) {
    if (!c.endedAt) throw new ConflictException('A visita ainda está em andamento');
    if (!c.completed)
      throw new ConflictException(
        `Só visitas de ao menos ${CHECKIN_MIN_MINUTES} minutos podem ser avaliadas`,
      );
    if (Date.now() - c.endedAt.getTime() > RATE_WINDOW_MS)
      throw new ConflictException('O prazo de 7 dias para avaliar esta visita acabou');
  }

  private async createRating(
    checkInId: string,
    direction: 'VISITANTE_AVALIA_PONTO' | 'ANFITRIAO_AVALIA_VISITANTE',
    authorId: string,
    dto: PointRatingDto,
  ) {
    try {
      await this.prisma.pointRating.create({
        data: {
          checkInId,
          direction,
          authorId,
          stars: dto.stars,
          comment: dto.comment?.trim() || null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Você já avaliou esta visita');
      throw e;
    }
  }

  private checkInView(c: CheckIn) {
    return {
      id: c.id,
      pointId: c.pointId,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      completed: c.completed,
      expiresAt: new Date(c.startedAt.getTime() + CHECKIN_MAX_MINUTES * 60_000),
      minMinutes: CHECKIN_MIN_MINUTES,
    };
  }
}
