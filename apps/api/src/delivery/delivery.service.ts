import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import {
  ACTIVE_DRIVER_STATUSES,
  BOARDING_PIN_MAX_ATTEMPTS,
  TRIP_POINT_MIN_INTERVAL_SECONDS,
  generateBoardingPin,
  pricingProfile,
  type DeliveryKind,
  type PricingProfile,
  type RatingDirection,
  type RideVehicleType,
  CANCEL_RULES,
  buildRideSettlement,
  calculateFare,
  calculateRideFees,
  buildReceipt,
  canCancel,
  canIssueReceipt,
  haversineMeters,
  refundAction,
  type AssociationRate,
  type GeoPoint,
  type CancelReason,
  type DeliveryStatus,
} from '@amma/shared';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.guard';
import { DispatchService } from '../dispatch/dispatch.service';
import { LedgerService } from '../ledger/ledger.service';
import { PositionStore } from '../presence/position-store';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ROUTE_PROVIDER, type RouteProvider } from '../routing/route-provider';
import { PaymentsService } from '../payments/payments.service';
import { RatingsService } from '../safety/ratings.service';
import { CancelDto, CreateDeliveryDto, RatingDto } from './dto';
import { cancelDelivery, moveStatus } from './transitions';
import { deliveryView, type RideExtras, type Viewer } from './views';

/** Entregas muito curtas são provavelmente erro de digitação do endereço. */
const MIN_PICKUP_DROPOFF_METERS = 20;
/** Posições do mesmo motorista mais frequentes que isto são descartadas. */
const MIN_POSITION_INTERVAL_MS = 1000;

/** Opções da corrida de passageiro; sem elas o pedido é uma entrega. */
export interface RideOptions {
  vehicleType: RideVehicleType;
  womenDriverOnly: boolean;
}

/** Os relacionamentos que toda leitura de pedido traz. */
const VIEW_INCLUDE = {
  worker: { select: { name: true } },
  payment: true,
  ratings: true,
  vehicle: true,
} as const;

/** Passos do motorista: estado de destino → estado anterior exigido. */
const DRIVER_STEPS = {
  A_CAMINHO_COLETA: 'ACEITO',
  COLETADO: 'A_CAMINHO_COLETA',
  A_CAMINHO_ENTREGA: 'COLETADO',
  ENTREGUE: 'A_CAMINHO_ENTREGA',
} as const satisfies Partial<Record<DeliveryStatus, DeliveryStatus>>;
export type DriverStep = keyof typeof DRIVER_STEPS;

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');
  private readonly lastPosition = new Map<string, number>();
  private readonly lastTripPoint = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly dispatch: DispatchService,
    private readonly realtime: RealtimeService,
    private readonly positions: PositionStore,
    private readonly presence: PresenceService,
    private readonly payments: PaymentsService,
    private readonly ratings: RatingsService,
    @Inject(ROUTE_PROVIDER) private readonly routes: RouteProvider,
  ) {}

  // ---------------------------------------------------------------- cliente

  /** Cotação: rota do provedor + tabela de preço vigente (com piso). Não cria nada. */
  async quote(dto: { pickup: GeoPoint; dropoff: GeoPoint }, profile: PricingProfile = 'ENTREGA') {
    const route = await this.route(dto);
    return this.priceRoute(route, profile);
  }

  /** Rota entre os dois pontos (a mesma para todos os tipos de veículo). */
  async route(dto: { pickup: GeoPoint; dropoff: GeoPoint }) {
    if (haversineMeters(dto.pickup, dto.dropoff) < MIN_PICKUP_DROPOFF_METERS)
      throw new BadRequestException('Origem e destino estão no mesmo lugar');
    return this.routes.route(dto.pickup, dto.dropoff).catch((e: Error) => {
      this.logger.error(`Rota indisponível: ${e.message}`);
      throw new ServiceUnavailableException('Não foi possível calcular a rota agora');
    });
  }

  async priceRoute(
    route: { distanceMeters: number; durationSeconds: number },
    profile: PricingProfile,
  ) {
    const config = await this.pricing.current(new Date(), profile);
    const fare = calculateFare(route.distanceMeters, route.durationSeconds, config);
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      fareCents: fare.fareCents,
      minimumApplied: fare.minimumApplied,
      pricingVersion: fare.configVersion,
    };
  }

  /**
   * Pede a entrega e cobra. Cartão: cobrado na hora (recusado → 402 e nada é criado). Pix: o pedido
   * nasce `CRIADO` com pagamento PENDENTE e só entra no despacho depois de pago.
   * A chave de idempotência faz repetir o pedido devolver o mesmo, sem cobrar de novo.
   * Com `ride`, o pedido é uma corrida de passageiro (mesmo fluxo, com PIN de embarque).
   */
  async create(
    user: AuthUser,
    dto: Omit<CreateDeliveryDto, 'notes'> & { notes?: string },
    ride?: RideOptions,
  ) {
    const clientId = user.id;
    const key = dto.idempotencyKey;
    const existing = () =>
      key
        ? this.prisma.delivery.findUnique({
            where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } },
            select: { id: true },
          })
        : null;
    const prev = await existing();
    if (prev) return this.get(user, prev.id);

    const kind: DeliveryKind = ride ? 'CORRIDA' : 'ENTREGA';
    const q = await this.quote(dto, pricingProfile(kind, ride?.vehicleType));
    if (dto.expectedFareCents !== undefined && dto.expectedFareCents !== q.fareCents)
      throw new ConflictException('O preço mudou. Confira o novo valor antes de confirmar.');
    const id = randomUUID();
    const charge = await this.payments.charge({
      reference: id,
      amountCents: q.fareCents,
      method: dto.payment.method,
      cardToken: dto.payment.cardToken,
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.delivery.create({
          data: {
            id,
            kind,
            ...(ride
              ? {
                  vehicleType: ride.vehicleType,
                  womenDriverOnly: ride.womenDriverOnly,
                  boardingPin: generateBoardingPin(randomInt),
                }
              : {}),
            clientId,
            idempotencyKey: key,
            pickupLat: dto.pickup.lat,
            pickupLng: dto.pickup.lng,
            pickupAddress: dto.pickup.address.trim(),
            dropoffLat: dto.dropoff.lat,
            dropoffLng: dto.dropoff.lng,
            dropoffAddress: dto.dropoff.address.trim(),
            notes: dto.notes?.trim() || null,
            ...q,
            payment: { create: charge },
          },
        });
        await tx.deliveryEvent.create({
          data: { deliveryId: id, type: 'STATUS', toStatus: 'CRIADO', actorId: clientId },
        });
      });
    } catch (e) {
      // Cobrou mas não gravou: devolve o dinheiro antes de falhar.
      await this.payments.undoCharge(charge);
      if ((e as { code?: string }).code === 'P2002') {
        const dup = await existing();
        if (dup) return this.get(user, dup.id);
      }
      throw e;
    }
    // Pago (cartão): primeira tentativa de despacho na hora; se falhar, a rotina periódica tenta de novo.
    if (charge.status === 'PAGO')
      await this.dispatch
        .dispatch(id)
        .catch((e: Error) => this.logger.error(`Despacho inicial falhou: ${e.message}`));
    return this.get(user, id);
  }

  list(clientId: string, status?: DeliveryStatus, limit = 20, kind: DeliveryKind = 'ENTREGA') {
    return this.prisma.delivery
      .findMany({
        where: { clientId, kind, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: VIEW_INCLUDE,
      })
      .then((rows) => rows.map((d) => deliveryView(d, 'CLIENTE', this.payments.provider)));
  }

  /** Cliente dono, motorista responsável ou admin. Para os demais, "não encontrado". */
  async get(user: AuthUser, id: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, include: VIEW_INCLUDE });
    const viewer = this.viewerOf(user, d);
    if (!d || !viewer) throw new NotFoundException('Pedido não encontrado');
    const [events, driverPosition, extras] = await Promise.all([
      this.prisma.deliveryEvent.findMany({
        where: { deliveryId: id, type: 'STATUS' },
        orderBy: { createdAt: 'asc' },
        select: { toStatus: true, reason: true, createdAt: true },
      }),
      viewer !== 'MOTORISTA' && d.workerId && this.isOngoing(d.status)
        ? this.positions.get(d.workerId)
        : null,
      this.extrasFor(d),
    ]);
    return {
      ...deliveryView(d, viewer, this.payments.provider, extras),
      timeline: events.map((e) => ({ status: e.toStatus, reason: e.reason, at: e.createdAt })),
      driverPosition,
    };
  }

  /** Reputação das duas partes de uma corrida (a outra parte vê só a média e a quantidade). */
  private async extrasFor(d: {
    kind: DeliveryKind;
    clientId: string;
    workerId: string | null;
  }): Promise<RideExtras> {
    if (d.kind !== 'CORRIDA') return {};
    const [driverRating, passengerRating, client] = await Promise.all([
      d.workerId ? this.ratings.summary(d.workerId, 'CLIENTE_AVALIA_MOTORISTA') : undefined,
      this.ratings.summary(d.clientId, 'MOTORISTA_AVALIA_CLIENTE'),
      this.prisma.user.findUnique({ where: { id: d.clientId }, select: { name: true } }),
    ]);
    return { driverRating, passengerRating, client: client ?? undefined };
  }

  /** Registro completo das decisões (admin). */
  async events(id: string) {
    const exists = await this.prisma.delivery.count({ where: { id } });
    if (!exists) throw new NotFoundException('Pedido não encontrado');
    return this.prisma.deliveryEvent.findMany({
      where: { deliveryId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  private viewerOf(user: AuthUser, d: { clientId: string; workerId: string | null } | null) {
    if (!d) return null;
    if (user.roles.includes('ADMIN')) return 'ADMIN' as Viewer;
    if (d.clientId === user.id) return 'CLIENTE' as Viewer;
    if (d.workerId === user.id) return 'MOTORISTA' as Viewer;
    return null;
  }

  private isOngoing(s: DeliveryStatus) {
    return (
      s === 'ACEITO' || s === 'A_CAMINHO_COLETA' || s === 'COLETADO' || s === 'A_CAMINHO_ENTREGA'
    );
  }

  // ---------------------------------------------------------------- cancelamento

  async cancel(user: AuthUser, id: string, dto: CancelDto) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    const viewer = this.viewerOf(user, d);
    if (!d || !viewer) throw new NotFoundException('Pedido não encontrado');

    const rule = CANCEL_RULES[dto.reason];
    // O ator vem do motivo; aqui confere se QUEM pediu é mesmo esse ator.
    const authorized =
      (rule.actor === 'CLIENTE' && d.clientId === user.id) ||
      (rule.actor === 'MOTORISTA' && d.workerId === user.id) ||
      (rule.actor === 'ADMIN' && user.roles.includes('ADMIN'));
    if (!authorized) throw new ForbiddenException('Você não pode cancelar por este motivo');
    if (rule.actor === 'ADMIN' && !dto.note?.trim())
      throw new BadRequestException('Cancelamento administrativo exige justificativa (note)');
    if (!canCancel(d.status, dto.reason, rule.actor))
      throw new ConflictException(
        `Não é possível cancelar por ${dto.reason} no estado ${d.status}`,
      );

    const pending = await this.prisma.deliveryOffer.findMany({
      where: { deliveryId: id, status: 'PENDENTE' },
      select: { id: true, driverId: true },
    });
    const ok = await this.prisma.$transaction((tx) =>
      cancelDelivery(tx, {
        id,
        from: d.status,
        reason: dto.reason,
        note: dto.note?.trim(),
        actorId: user.id,
      }),
    );
    if (!ok) throw new ConflictException('O pedido mudou de estado; tente novamente');

    for (const o of pending)
      this.realtime.sendToUser(o.driverId, 'offer.closed', { offerId: o.id, reason: 'CANCELADO' });
    this.notify(d, 'CANCELADO', dto.reason);
    // Cancelou: devolve o dinheiro (ou invalida o Pix pendente). Se falhar, a rotina tenta de novo.
    await this.payments.afterCancel(id);
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- avaliação, recibo e estorno

  /**
   * Avaliação, uma vez por direção, depois de concluído. O cliente avalia o motorista (entrega e
   * corrida); o motorista avalia o passageiro (só corrida). Quem recebe a nota não vê a nota nem o comentário.
   */
  async rate(
    user: AuthUser,
    id: string,
    dto: RatingDto,
    direction: RatingDirection = 'CLIENTE_AVALIA_MOTORISTA',
  ) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    const byClient = direction === 'CLIENTE_AVALIA_MOTORISTA';
    if (!d || (byClient ? d.clientId : d.workerId) !== user.id)
      throw new NotFoundException('Pedido não encontrado');
    if (!byClient && d.kind !== 'CORRIDA')
      throw new ConflictException('Só as corridas de passageiro têm avaliação do motorista');
    if (d.status !== 'ENTREGUE' || !d.workerId)
      throw new ConflictException('Só dá para avaliar depois de concluído');
    try {
      await this.prisma.rating.create({
        data: {
          deliveryId: id,
          direction,
          authorId: user.id,
          rateeId: byClient ? d.workerId : d.clientId,
          stars: dto.stars,
          comment: dto.comment?.trim() || null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Você já avaliou');
      throw e;
    }
    return this.get(user, id);
  }

  /** Recibo do pagamento. Só o cliente dono (ou o admin), e só com pagamento confirmado. */
  async receipt(user: AuthUser, id: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, include: { payment: true } });
    const viewer = this.viewerOf(user, d);
    if (!d || (viewer !== 'CLIENTE' && viewer !== 'ADMIN'))
      throw new NotFoundException('Pedido não encontrado');
    const p = d.payment;
    const input = {
      deliveryId: d.id,
      kind: d.kind,
      createdAt: d.createdAt.toISOString(),
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
      status: d.status,
      pickupAddress: d.pickupAddress,
      dropoffAddress: d.dropoffAddress,
      distanceMeters: d.distanceMeters,
      durationSeconds: d.durationSeconds,
      fareCents: d.fareCents,
      minimumApplied: d.minimumApplied,
      pricingVersion: d.pricingVersion,
      payment: p && {
        method: p.method,
        status: p.status,
        amountCents: p.amountCents,
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        paidAt: p.paidAt?.toISOString() ?? null,
        refundedAt: p.refundedAt?.toISOString() ?? null,
      },
    };
    if (!canIssueReceipt(input))
      throw new ConflictException('O recibo fica disponível depois que o pagamento é confirmado');
    return buildReceipt(input);
  }

  /**
   * Estorno pelo admin: serve para repetir um estorno que falhou. Pedido ENTREGUE não é estornado
   * aqui: devolver o dinheiro exigiria reverter o repasse do motorista, e a regra de disputa ainda
   * não existe (ver docs/PROGRESSO.md).
   */
  async adminRefund(id: string, reason: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, include: { payment: true } });
    if (!d?.payment) throw new NotFoundException('Pagamento não encontrado');
    const action = refundAction(d.status, d.payment.status);
    if (action === 'MANUAL')
      throw new ConflictException(
        'Pedido já entregue: o estorno depende de reverter o repasse do motorista (regra de disputa pendente)',
      );
    if (action !== 'ESTORNAR')
      throw new ConflictException('Não há pagamento a estornar neste pedido');
    await this.payments.refund(id, `ADMIN: ${reason}`);
    return this.prisma.payment
      .findUniqueOrThrow({ where: { deliveryId: id } })
      .then((p) => ({ status: p.status, refundedAt: p.refundedAt }));
  }

  // ---------------------------------------------------------------- motorista

  /** Avança um passo (a caminho da coleta → coletado → a caminho da entrega → entregue). */
  async advance(driverId: string, id: string, to: DriverStep, pin?: string) {
    const from = DRIVER_STEPS[to];
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d || d.workerId !== driverId) throw new NotFoundException('Pedido não encontrado');
    if (d.status !== from)
      throw new ConflictException(`Pedido está em ${d.status}; esperado ${from}`);
    // Corrida: o embarque só é confirmado com o PIN que o passageiro mostra (verifica quem embarca).
    if (to === 'COLETADO' && d.kind === 'CORRIDA') await this.checkBoardingPin(d, pin);

    const now = new Date();
    const ok = await this.prisma.$transaction(async (tx) => {
      if (to === 'ENTREGUE') return this.settle(tx, d, driverId, now);
      return moveStatus(tx, {
        id,
        from,
        to,
        where: { workerId: driverId },
        data: to === 'COLETADO' ? { pickedUpAt: now } : undefined,
        actorId: driverId,
      });
    });
    if (!ok) throw new ConflictException('O pedido mudou de estado; tente novamente');
    this.notify(d, to);
    const fresh = await this.prisma.delivery.findUniqueOrThrow({ where: { id } });
    return deliveryView(fresh, 'MOTORISTA', undefined, await this.extrasFor(fresh));
  }

  /**
   * Confere o PIN. O contador sobe ANTES da comparação e de forma atômica: tentativas simultâneas
   * não furam o limite, e depois dele o embarque trava (o passageiro cancela ou chama a associação).
   */
  private async checkBoardingPin(d: { id: string; boardingPin: string | null }, pin?: string) {
    const counted = await this.prisma.delivery.updateMany({
      where: { id: d.id, boardingPinAttempts: { lt: BOARDING_PIN_MAX_ATTEMPTS } },
      data: { boardingPinAttempts: { increment: 1 } },
    });
    if (counted.count === 0)
      throw new ConflictException(
        'Muitas tentativas de PIN. Confira o motorista e o veículo; o passageiro pode cancelar a corrida.',
      );
    if (!pin || pin !== d.boardingPin)
      throw new ForbiddenException('PIN de embarque incorreto. Peça o PIN ao passageiro.');
  }

  /**
   * Conclusão: congela as taxas no pedido e grava o fechamento no ledger, na MESMA transação.
   * Se o ledger recusar (ex.: pedido já fechado), nada é salvo.
   */
  private async settle(
    tx: Prisma.TransactionClient,
    d: { id: string; fareCents: number },
    driverId: string,
    now: Date,
  ): Promise<boolean> {
    const profile = await tx.driverProfile.findUnique({
      where: { userId: driverId },
      select: { associationRate: true },
    });
    const rate = (profile?.associationRate ?? 0) as AssociationRate;
    const fees = calculateRideFees(d.fareCents, rate);
    const moved = await moveStatus(tx, {
      id: d.id,
      from: 'A_CAMINHO_ENTREGA',
      to: 'ENTREGUE',
      where: { workerId: driverId },
      data: {
        deliveredAt: now,
        platformFeeCents: fees.platformFeeCents,
        associationFeeCents: fees.associationFeeCents,
        workerNetCents: fees.workerNetCents,
        associationRate: rate,
      },
      actorId: driverId,
    });
    if (!moved) return false;
    try {
      await this.ledger.post(
        tx,
        buildRideSettlement({
          id: randomUUID(),
          rideId: d.id,
          workerId: driverId,
          grossCents: d.fareCents,
          associationRate: rate,
          createdAt: now.toISOString(),
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Este pedido já foi fechado no ledger');
      throw e;
    }
    return true;
  }

  async activeFor(driverId: string) {
    const d = await this.prisma.delivery.findFirst({
      where: {
        workerId: driverId,
        status: { in: ['ACEITO', 'A_CAMINHO_COLETA', 'COLETADO', 'A_CAMINHO_ENTREGA'] },
      },
    });
    return d ? deliveryView(d, 'MOTORISTA', undefined, await this.extrasFor(d)) : null;
  }

  /**
   * Posição do motorista (WebSocket ou REST): grava na presença e, com entrega em andamento,
   * repassa ao cliente. Devolve false se o motorista não está online.
   */
  async reportDriverPosition(driverId: string, p: GeoPoint): Promise<boolean> {
    const last = this.lastPosition.get(driverId);
    const now = Date.now();
    // Mais de 1 por segundo é app com defeito: descarta sem tratar como erro.
    if (last && now - last < MIN_POSITION_INTERVAL_MS) return true;
    this.lastPosition.set(driverId, now);
    const accepted = await this.presence.updatePosition(driverId, p);
    if (!accepted) {
      this.lastPosition.delete(driverId);
      return false;
    }
    await this.relayToClient(driverId, p);
    return true;
  }

  private async relayToClient(driverId: string, p: GeoPoint) {
    try {
      const active = await this.prisma.delivery.findFirst({
        where: { workerId: driverId, status: { in: [...ACTIVE_DRIVER_STATUSES] } },
        select: { id: true, clientId: true, kind: true, status: true },
      });
      if (active) await this.recordTripPoint(active, p);
      if (active)
        this.realtime.sendToUser(active.clientId, 'driver.position', {
          deliveryId: active.id,
          lat: p.lat,
          lng: p.lng,
          at: new Date().toISOString(),
        });
    } catch (e) {
      this.logger.warn(`Falha ao repassar posição: ${(e as Error).message}`);
    }
  }

  /**
   * Registro da viagem (segurança): guarda a posição do veículo durante a corrida, no máximo uma a
   * cada TRIP_POINT_MIN_INTERVAL_SECONDS. Só corridas, e só enquanto há passageiro a caminho ou a bordo.
   */
  private async recordTripPoint(
    d: { id: string; kind: DeliveryKind; status: DeliveryStatus },
    p: GeoPoint,
  ) {
    if (d.kind !== 'CORRIDA' || d.status === 'ACEITO') return;
    const now = Date.now();
    if (now - (this.lastTripPoint.get(d.id) ?? 0) < TRIP_POINT_MIN_INTERVAL_SECONDS * 1000) return;
    this.lastTripPoint.set(d.id, now);
    await this.prisma.tripPoint.create({ data: { deliveryId: d.id, lat: p.lat, lng: p.lng } });
  }

  private notify(
    d: { id: string; clientId: string; workerId: string | null },
    status: DeliveryStatus,
    cancelReason?: CancelReason,
  ) {
    const payload = { id: d.id, status, ...(cancelReason ? { cancelReason } : {}) };
    this.realtime.sendToUser(d.clientId, 'delivery.updated', payload);
    if (d.workerId) this.realtime.sendToUser(d.workerId, 'delivery.updated', payload);
  }
}
