import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  EMERGENCY_DEDUP_SECONDS,
  REPORTS_PER_DAY_LIMIT,
  SHARE_MAX_ACTIVE_PER_RIDE,
  TRIP_RECORD_NOTICE,
  TRIP_RECORD_RETENTION_DAYS,
  canShareRide,
  firstName,
  isSevereReport,
  shareIsOpen,
  statusLabel,
  tripRecordExpiry,
  type EmergencyStatus,
  type ReportStatus,
} from '@amma/shared';
import { AuthUser } from '../auth/auth.guard';
import { StorageService } from '../common/storage.service';
import { PositionStore } from '../presence/position-store';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { EmergencyDto, EmergencyUpdateDto, ReportDto, ReportUpdateDto } from '../delivery/dto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{32,64}$/;
const MAX_LIST = 200;

type Role = 'PASSAGEIRO' | 'MOTORISTA';

/** Emergência, denúncia, viagem compartilhada e registro da viagem. */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger('Safety');

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly positions: PositionStore,
    private readonly storage: StorageService,
  ) {}

  /** Pedido em que o usuário é cliente ou motorista; para qualquer outro, "não encontrado". */
  private async participation(userId: string, deliveryId: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    const role: Role | null =
      d?.clientId === userId ? 'PASSAGEIRO' : d?.workerId === userId ? 'MOTORISTA' : null;
    if (!d || !role) throw new NotFoundException('Corrida não encontrada');
    return { d, role };
  }

  // ---------------------------------------------------------------- emergência

  /**
   * Botão de emergência: registra o alerta (com a posição) e avisa os administradores em tempo real.
   * O app também liga para 190/192/193; isto é o aviso à associação. Apertar de novo logo em seguida
   * atualiza o alerta aberto em vez de abrir outro.
   */
  async emergency(user: AuthUser, dto: EmergencyDto) {
    let role: Role = user.roles.includes('MOTORISTA') ? 'MOTORISTA' : 'PASSAGEIRO';
    if (dto.deliveryId) role = (await this.participation(user.id, dto.deliveryId)).role;
    const since = new Date(Date.now() - EMERGENCY_DEDUP_SECONDS * 1000);
    const open = await this.prisma.emergencyAlert.findFirst({
      where: {
        userId: user.id,
        deliveryId: dto.deliveryId ?? null,
        status: 'ABERTO',
        createdAt: { gte: since },
      },
    });
    const data = { lat: dto.lat ?? null, lng: dto.lng ?? null, note: dto.note?.trim() || null };
    const alert = open
      ? await this.prisma.emergencyAlert.update({
          where: { id: open.id },
          data: {
            ...(data.lat !== null ? { lat: data.lat, lng: data.lng } : {}),
            note: data.note ?? open.note,
          },
        })
      : await this.prisma.emergencyAlert.create({
          data: { userId: user.id, deliveryId: dto.deliveryId, actorRole: role, ...data },
        });
    if (!open) {
      this.logger.warn(`EMERGÊNCIA ${alert.id} (${role}) corrida=${dto.deliveryId ?? '-'}`);
      const admins = await this.prisma.user.findMany({
        where: { roles: { has: 'ADMIN' }, deletedAt: null },
        select: { id: true },
      });
      for (const a of admins)
        this.realtime.sendToUser(a.id, 'safety.emergency', {
          id: alert.id,
          deliveryId: dto.deliveryId ?? null,
          actorRole: role,
        });
    }
    return { id: alert.id, status: alert.status, createdAt: alert.createdAt };
  }

  listAlerts(status?: EmergencyStatus) {
    return this.prisma.emergencyAlert.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST,
      include: { user: { select: { name: true, phone: true } } },
    });
  }

  async updateAlert(id: string, adminId: string, dto: EmergencyUpdateDto) {
    const r = await this.prisma.emergencyAlert.updateMany({
      where: { id },
      data: { status: dto.status, handledById: adminId, handledNote: dto.note?.trim() || null },
    });
    if (r.count === 0) throw new NotFoundException('Alerta não encontrado');
    return this.prisma.emergencyAlert.findUniqueOrThrow({ where: { id } });
  }

  // ---------------------------------------------------------------- denúncia

  /**
   * Denúncia. Com `deliveryId`, o denunciado é a OUTRA parte daquela corrida/entrega — o app não aceita
   * um id de usuário qualquer, para o canal não virar ferramenta de perseguição.
   */
  async report(user: AuthUser, dto: ReportDto) {
    const today = new Date(Date.now() - 86_400_000);
    const recent = await this.prisma.report.count({
      where: { reporterId: user.id, createdAt: { gte: today } },
    });
    if (recent >= REPORTS_PER_DAY_LIMIT)
      throw new ConflictException(
        'Limite diário de denúncias atingido. Tente amanhã ou ligue para a associação.',
      );
    let reportedId: string | null = null;
    if (dto.deliveryId) {
      const { d, role } = await this.participation(user.id, dto.deliveryId);
      reportedId = role === 'PASSAGEIRO' ? d.workerId : d.clientId;
    }
    const r = await this.prisma.report.create({
      data: {
        reporterId: user.id,
        reportedId,
        deliveryId: dto.deliveryId,
        category: dto.category,
        description: dto.description.trim(),
      },
    });
    return { id: r.id, status: r.status, createdAt: r.createdAt };
  }

  /** As denúncias de quem pergunta, com a resposta da associação. Nada sobre o denunciado. */
  myReports(userId: string) {
    return this.prisma.report.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        deliveryId: true,
        category: true,
        status: true,
        resolution: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** Fila do admin: abertas e em análise primeiro; as graves antes das demais. */
  async adminReports(status?: ReportStatus) {
    const rows = await this.prisma.report.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'asc' },
      take: MAX_LIST,
      include: {
        reporter: { select: { name: true, phone: true } },
        reported: { select: { name: true, phone: true } },
      },
    });
    return rows
      .map((r) => ({ ...r, severe: isSevereReport(r.category) }))
      .sort((a, b) => Number(b.severe) - Number(a.severe));
  }

  async updateReport(id: string, adminId: string, dto: ReportUpdateDto) {
    const r = await this.prisma.report.updateMany({
      where: { id },
      data: {
        status: dto.status,
        handledById: adminId,
        resolution: dto.resolution?.trim() || null,
      },
    });
    if (r.count === 0) throw new NotFoundException('Denúncia não encontrada');
    return this.prisma.report.findUniqueOrThrow({ where: { id } });
  }

  // ---------------------------------------------------------------- viagem compartilhada

  /**
   * Gera um link para um contato acompanhar a corrida. O link vale durante a corrida e por pouco
   * tempo depois; o passageiro pode revogar. O token só aparece aqui, uma vez (guardamos o hash).
   */
  async createShare(user: AuthUser, rideId: string, contactLabel?: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id: rideId } });
    if (!d || d.clientId !== user.id || d.kind !== 'CORRIDA')
      throw new NotFoundException('Corrida não encontrada');
    if (!canShareRide(d.status))
      throw new ConflictException(
        'Só dá para compartilhar uma corrida em andamento, com motorista',
      );
    const active = await this.prisma.tripShare.count({
      where: { deliveryId: rideId, revokedAt: null },
    });
    if (active >= SHARE_MAX_ACTIVE_PER_RIDE)
      throw new ConflictException(`Limite de ${SHARE_MAX_ACTIVE_PER_RIDE} links por corrida`);
    const token = randomBytes(24).toString('base64url');
    const row = await this.prisma.tripShare.create({
      data: {
        deliveryId: rideId,
        tokenHash: sha256(token),
        contactLabel: contactLabel?.trim() || null,
      },
    });
    return { id: row.id, token, contactLabel: row.contactLabel, createdAt: row.createdAt };
  }

  async listShares(user: AuthUser, rideId: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id: rideId } });
    if (!d || d.clientId !== user.id) throw new NotFoundException('Corrida não encontrada');
    return this.prisma.tripShare.findMany({
      where: { deliveryId: rideId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, contactLabel: true, createdAt: true, revokedAt: true },
    });
  }

  async revokeShare(user: AuthUser, rideId: string, shareId: string) {
    const r = await this.prisma.tripShare.updateMany({
      where: { id: shareId, deliveryId: rideId, delivery: { clientId: user.id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) throw new NotFoundException('Link não encontrado');
  }

  /**
   * O que o contato vê pelo link. É propositalmente pouco: primeiro nome do motorista e do passageiro,
   * veículo, origem, destino, estado e posição atual. Nunca telefone, documento, valor ou pagamento.
   */
  async publicShare(token: string, now = new Date()) {
    if (!TOKEN_FORMAT.test(token)) throw new NotFoundException();
    const share = await this.prisma.tripShare.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        delivery: {
          include: {
            worker: { select: { name: true } },
            client: { select: { name: true } },
            vehicle: true,
          },
        },
      },
    });
    if (!share) throw new NotFoundException();
    const d = share.delivery;
    const ended = d.status === 'ENTREGUE' || d.status === 'CANCELADO';
    const endedAt = ended ? (d.deliveredAt ?? d.cancelledAt ?? d.updatedAt) : null;
    if (!shareIsOpen({ revoked: !!share.revokedAt, status: d.status, endedAt }, now))
      throw new NotFoundException();
    const [position, emergency] = await Promise.all([
      !ended && d.workerId ? this.positions.get(d.workerId) : null,
      this.prisma.emergencyAlert.count({
        where: { deliveryId: d.id, status: { not: 'ENCERRADO' } },
      }),
    ]);
    return {
      status: d.status,
      statusText: statusLabel('CORRIDA', d.status),
      ended,
      passenger: firstName(d.client.name),
      driver: firstName(d.worker?.name),
      vehicle: d.vehicle
        ? { type: d.vehicle.type, plate: d.vehicle.plate, model: d.vehicle.model }
        : null,
      pickup: d.pickupAddress,
      dropoff: d.dropoffAddress,
      driverPosition: position ? { lat: position.lat, lng: position.lng, at: position.at } : null,
      emergency: emergency > 0,
      updatedAt: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------- verificação do motorista

  /** Foto do motorista (último FOTO aprovado) para o passageiro conferir quem chegou. */
  async driverPhoto(user: AuthUser, rideId: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id: rideId } });
    if (!d || d.clientId !== user.id || d.kind !== 'CORRIDA' || !d.workerId)
      throw new NotFoundException('Foto não disponível');
    // Só durante a corrida: depois dela o passageiro não precisa mais da foto.
    if (!canShareRide(d.status)) throw new NotFoundException('Foto não disponível');
    const doc = await this.prisma.document.findFirst({
      where: { userId: d.workerId, type: 'FOTO', status: 'APROVADO' },
      orderBy: { createdAt: 'desc' },
    });
    if (!doc) throw new NotFoundException('Foto não disponível');
    return { mimeType: doc.mimeType, data: await this.storage.read(doc.storageKey) };
  }

  // ---------------------------------------------------------------- registro da viagem

  /** Registro da própria corrida (passageiro ou motorista): linha do tempo e trajeto. */
  async myRecord(user: AuthUser, rideId: string) {
    const { d } = await this.participation(user.id, rideId);
    if (d.kind !== 'CORRIDA') throw new NotFoundException('Corrida não encontrada');
    return this.record(d.id, false);
  }

  /** Registro completo para a associação (denúncia/emergência). Cada abertura fica auditada. */
  async adminRecord(adminId: string, rideId: string) {
    const exists = await this.prisma.delivery.count({ where: { id: rideId } });
    if (!exists) throw new NotFoundException('Corrida não encontrada');
    await this.prisma.tripRecordAccess.create({ data: { deliveryId: rideId, adminId } });
    return this.record(rideId, true);
  }

  private async record(rideId: string, full: boolean) {
    const [events, points, extra] = await Promise.all([
      this.prisma.deliveryEvent.findMany({
        where: { deliveryId: rideId, ...(full ? {} : { type: 'STATUS' }) },
        orderBy: { createdAt: 'asc' },
        select: {
          type: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdAt: true,
          ...(full ? { actorId: true, data: true } : {}),
        },
      }),
      this.prisma.tripPoint.findMany({
        where: { deliveryId: rideId },
        orderBy: { at: 'asc' },
        take: 5000,
        select: { lat: true, lng: true, at: true },
      }),
      full
        ? Promise.all([
            this.prisma.emergencyAlert.findMany({
              where: { deliveryId: rideId },
              orderBy: { createdAt: 'asc' },
            }),
            this.prisma.report.findMany({
              where: { deliveryId: rideId },
              orderBy: { createdAt: 'asc' },
            }),
            this.prisma.tripShare.count({ where: { deliveryId: rideId } }),
            this.prisma.tripRecordAccess.findMany({
              where: { deliveryId: rideId },
              orderBy: { createdAt: 'asc' },
            }),
          ])
        : null,
    ]);
    return {
      deliveryId: rideId,
      notice: TRIP_RECORD_NOTICE,
      retentionDays: TRIP_RECORD_RETENTION_DAYS,
      events,
      points,
      ...(extra
        ? { alerts: extra[0], reports: extra[1], sharesCreated: extra[2], accessLog: extra[3] }
        : {}),
    };
  }

  /**
   * Apaga posições antigas. Corridas com denúncia ou alerta ficam (guarda para apuração) até a
   * associação resolver o caso. Chamado pela rotina periódica.
   */
  async purgeTripPoints(now = new Date()): Promise<number> {
    const r = await this.prisma.tripPoint.deleteMany({
      where: {
        at: { lt: tripRecordExpiry(now) },
        delivery: { reports: { none: {} }, emergencyAlerts: { none: {} } },
      },
    });
    return r.count;
  }

  // ---------------------------------------------------------------- motorista: gênero

  /** Admin confere a autodeclaração do motorista; só então ele recebe pedidos "motorista mulher". */
  async verifyGender(driverId: string, adminId: string, verified: boolean) {
    const p = await this.prisma.driverProfile.findUnique({ where: { userId: driverId } });
    if (!p) throw new NotFoundException('Motorista não encontrado');
    if (verified && p.gender !== 'FEMININO')
      throw new BadRequestException('O motorista não se declarou do gênero feminino');
    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: verified
        ? { genderVerifiedAt: new Date(), genderVerifiedById: adminId }
        : { genderVerifiedAt: null, genderVerifiedById: adminId },
    });
    return { driverId, verified };
  }
}
