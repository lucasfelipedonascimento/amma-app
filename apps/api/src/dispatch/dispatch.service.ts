import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ACTIVE_DRIVER_STATUSES,
  canDispatch,
  chooseCandidate,
  firstName,
  isVerifiedWoman,
  type DeclineReason,
  type DispatchCandidate,
  type DispatchConfig,
  type DispatchReason,
} from '@amma/shared';
import { type Delivery } from '@prisma/client';
import { MunicipalRulesService } from '../municipal/municipal-rules.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RatingsService } from '../safety/ratings.service';
import { ROUTE_PROVIDER, type RouteProvider } from '../routing/route-provider';
import { cancelDelivery, moveStatus, recordEvent } from '../delivery/transitions';
import { offerView } from '../delivery/views';
import { DispatchSettingsService } from './dispatch-settings.service';

/** Máximo de candidatos lidos do PostGIS por tentativa (ordenados por distância). */
const MAX_CANDIDATES = 200;
/** Tentativas por rodada caso o escolhido fique ocupado entre a escolha e a oferta. */
const MAX_ATTEMPTS = 3;
/** "Sem candidatos" é registrado no máximo uma vez por este intervalo, por pedido. */
const NO_CANDIDATES_LOG_EVERY_MS = 60_000;

export type DispatchOutcome = 'OFFERED' | 'NO_CANDIDATES' | 'CANCELLED' | 'SKIPPED';

interface CandidateRow {
  driverId: string;
  distance: number;
  locationAt: Date;
  onlineSince: Date | null;
  lat: number;
  lng: number;
  busy: boolean;
  tried: boolean;
}

/**
 * Despacho: oferece o pedido ao motorista elegível mais próximo, um por vez.
 * As regras (quem é elegível, como desempata) estão em `shared/dispatch.ts` e são públicas.
 * Este serviço busca os dados, aplica as regras e grava a decisão com o código do motivo.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger('Dispatch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: DispatchSettingsService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly payments: PaymentsService,
    private readonly municipal: MunicipalRulesService,
    private readonly ratings: RatingsService,
    @Inject(ROUTE_PROVIDER) private readonly routes: RouteProvider,
  ) {}

  // ---------------------------------------------------------------- escolha e oferta

  async dispatch(deliveryId: string): Promise<DispatchOutcome> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { payment: { select: { status: true, paidAt: true } } },
    });
    if (!delivery || delivery.status !== 'CRIADO') return 'SKIPPED';
    // Só procura motorista depois de o pagamento ser confirmado.
    if (!canDispatch(delivery.payment?.status ?? null)) return 'SKIPPED';
    const config = await this.settings.get();

    // A janela de busca conta do pagamento: quem pagou o Pix aos 10 min não perde a busca inteira.
    const searchStart = Math.max(
      delivery.createdAt.getTime(),
      delivery.payment?.paidAt?.getTime() ?? 0,
    );
    if (Date.now() - searchStart > config.maxSearchSeconds * 1000) {
      const ok = await this.prisma.$transaction(async (tx) => {
        const moved = await cancelDelivery(tx, {
          id: delivery.id,
          from: 'CRIADO',
          reason: 'SEM_MOTORISTA',
        });
        if (moved)
          await recordEvent(tx, {
            deliveryId: delivery.id,
            type: 'SEM_CANDIDATOS',
            reason: 'JANELA_ESGOTADA' satisfies DispatchReason,
            data: { maxSearchSeconds: config.maxSearchSeconds },
          });
        return moved;
      });
      if (ok) {
        this.realtime.sendToUser(delivery.clientId, 'delivery.updated', {
          id: delivery.id,
          status: 'CANCELADO',
          cancelReason: 'SEM_MOTORISTA',
        });
        // Ninguém aceitou: o cliente recebe o dinheiro de volta.
        await this.payments.afterCancel(delivery.id);
      }
      return ok ? 'CANCELLED' : 'SKIPPED';
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const rows = await this.candidates(delivery, config);
      const ids = rows.map((r) => r.driverId);
      const approved = await this.approvedDrivers(ids);
      const ride = delivery.kind === 'CORRIDA' ? await this.rideFilters(delivery, ids) : null;
      const now = Date.now();
      const choice = chooseCandidate(
        rows.map((r): DispatchCandidate => ({
          driverId: r.driverId,
          distanceMeters: Math.round(r.distance),
          positionAgeSeconds: (now - r.locationAt.getTime()) / 1000,
          approved: approved.has(r.driverId),
          busy: r.busy,
          alreadyTried: r.tried,
          onlineSince: (r.onlineSince ?? r.locationAt).toISOString(),
          // Entregas não têm estas restrições (campos omitidos = sem restrição).
          ...(ride
            ? {
                vehicleOk: ride.vehicleOk.has(r.driverId),
                preferenceOk: !delivery.womenDriverOnly || ride.women.has(r.driverId),
              }
            : {}),
        })),
        config,
      );

      if (!choice.chosen) {
        await this.logNoCandidates(delivery.id, rows.length, choice.excluded, config);
        return 'NO_CANDIDATES';
      }

      const chosen = choice.chosen;
      const row = rows.find((r) => r.driverId === chosen.driverId)!;
      // A estimativa de rota até a coleta é informativa; se o provedor falhar, a oferta sai sem ela.
      const eta = await this.routes
        .route({ lat: row.lat, lng: row.lng }, { lat: delivery.pickupLat, lng: delivery.pickupLng })
        .catch((e: Error) => {
          this.logger.warn(`Rota até a coleta indisponível: ${e.message}`);
          return null;
        });

      const offer = await this.createOffer(delivery, chosen, eta, choice, rows.length, config);
      if (offer) {
        const rate = await this.associationRateOf(chosen.driverId);
        const view = offerView(offer, delivery, rate, await this.passengerOf(delivery));
        this.realtime.sendToUser(chosen.driverId, 'offer.created', view);
        // Reforço para o app fechado/em segundo plano; não espera nem derruba o despacho.
        void this.push.notifyOffer(chosen.driverId, {
          id: offer.id,
          expiresAt: offer.expiresAt,
          estimatedNetCents: view.estimatedNetCents,
          deliveryDistanceMeters: view.deliveryDistanceMeters,
        });
        this.realtime.sendToUser(delivery.clientId, 'delivery.updated', {
          id: delivery.id,
          status: 'OFERECIDO',
        });
        return 'OFFERED';
      }
      // Algo mudou (motorista ocupou-se ou ficou offline; pedido já tratado): reavalia.
      const still = await this.prisma.delivery.findUnique({
        where: { id: delivery.id },
        select: { status: true },
      });
      if (still?.status !== 'CRIADO') return 'SKIPPED';
    }
    return 'NO_CANDIDATES';
  }

  private async createOffer(
    delivery: Delivery,
    chosen: DispatchCandidate,
    eta: { distanceMeters: number; durationSeconds: number } | null,
    choice: ReturnType<typeof chooseCandidate>,
    totalInRadius: number,
    config: DispatchConfig,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Trava a linha do motorista: duas ofertas simultâneas para o mesmo motorista se serializam.
      const locked = await tx.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "DriverPresence"
        WHERE "userId" = ${chosen.driverId} AND online = true FOR UPDATE`;
      if (locked.length === 0) return null;
      const busy =
        (await tx.deliveryOffer.count({
          where: { driverId: chosen.driverId, status: 'PENDENTE' },
        })) +
        (await tx.delivery.count({
          where: { workerId: chosen.driverId, status: { in: [...ACTIVE_DRIVER_STATUSES] } },
        }));
      if (busy > 0) return null;

      const moved = await moveStatus(tx, { id: delivery.id, from: 'CRIADO', to: 'OFERECIDO' });
      if (!moved) return null;
      const offer = await tx.deliveryOffer.create({
        data: {
          deliveryId: delivery.id,
          driverId: chosen.driverId,
          distanceMeters: chosen.distanceMeters,
          pickupEtaSeconds: eta?.durationSeconds,
          pickupRouteMeters: eta?.distanceMeters,
          expiresAt: new Date(Date.now() + config.offerTtlSeconds * 1000),
        },
      });
      await recordEvent(tx, {
        deliveryId: delivery.id,
        type: 'OFERTA',
        actorId: chosen.driverId,
        reason: 'OFERTA_MAIS_PROXIMO' satisfies DispatchReason,
        data: {
          offerId: offer.id,
          distanceMeters: chosen.distanceMeters,
          rank: 1,
          eligible: choice.eligible,
          inRadius: totalInRadius,
          excluded: choice.excluded,
          radiusMeters: config.radiusMeters,
          offerTtlSeconds: config.offerTtlSeconds,
        },
      });
      return offer;
    });
  }

  /** Motoristas online com posição, dentro do raio, do mais perto ao mais longe. */
  private candidates(
    delivery: Pick<Delivery, 'id' | 'pickupLat' | 'pickupLng'> & { clientId?: string },
    config: DispatchConfig,
  ): Promise<CandidateRow[]> {
    return this.prisma.$queryRaw<CandidateRow[]>`
      SELECT p."userId" AS "driverId",
             ST_Distance(p.location, q.pt)::float8 AS distance,
             p."locationAt", p."onlineSince",
             ST_Y(p.location::geometry)::float8 AS lat,
             ST_X(p.location::geometry)::float8 AS lng,
             (EXISTS (SELECT 1 FROM "Delivery" d
                       WHERE d."workerId" = p."userId"
                         AND d.status IN ('ACEITO','A_CAMINHO_COLETA','COLETADO','A_CAMINHO_ENTREGA'))
              OR EXISTS (SELECT 1 FROM "DeliveryOffer" o
                          WHERE o."driverId" = p."userId" AND o.status = 'PENDENTE')) AS busy,
             EXISTS (SELECT 1 FROM "DeliveryOffer" o
                      WHERE o."deliveryId" = ${delivery.id} AND o."driverId" = p."userId") AS tried
      FROM "DriverPresence" p,
           (SELECT ST_SetSRID(ST_MakePoint(${delivery.pickupLng}, ${delivery.pickupLat}), 4326)::geography AS pt) q
      WHERE p.online = true AND p.location IS NOT NULL AND p."locationAt" IS NOT NULL
        AND ST_DWithin(p.location, q.pt, ${config.radiusMeters})
        AND p."userId" <> ${delivery.clientId ?? ''}
      ORDER BY distance ASC
      LIMIT ${MAX_CANDIDATES}`;
  }

  /**
   * Corrida de passageiro: quais motoristas têm um veículo do tipo pedido dentro das regras municipais
   * vigentes e, se o passageiro pediu motorista mulher, quais são mulheres verificadas.
   */
  private async rideFilters(
    delivery: Pick<Delivery, 'vehicleType' | 'womenDriverOnly'>,
    ids: string[],
  ) {
    const { rules } = await this.municipal.current();
    const evals = await this.municipal.evaluateDriver(ids, rules);
    const vehicleOk = new Set<string>();
    for (const [driverId, list] of evals)
      if (list.some((v) => v.type === delivery.vehicleType && v.eligibility.eligible))
        vehicleOk.add(driverId);
    const women = new Set<string>();
    if (delivery.womenDriverOnly) {
      const profiles = await this.prisma.driverProfile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, gender: true, genderVerifiedAt: true },
      });
      for (const p of profiles)
        if (isVerifiedWoman(p.gender, p.genderVerifiedAt)) women.add(p.userId);
    }
    return { vehicleOk, women };
  }

  /**
   * Quantos motoristas poderiam atender uma corrida pedida agora e em quanto tempo o mais próximo chega.
   * Usa as mesmas regras do despacho (online, aprovado, posição recente, no raio, veículo e preferência),
   * mas só informa: não oferece nada a ninguém.
   */
  async availability(
    pickup: { lat: number; lng: number },
    vehicleType: 'CARRO' | 'MOTO',
    womenDriverOnly: boolean,
  ): Promise<{ drivers: number; pickupEtaSeconds: number | null }> {
    const config = await this.settings.get();
    const rows = await this.candidates(
      { id: '00000000-0000-0000-0000-000000000000', pickupLat: pickup.lat, pickupLng: pickup.lng },
      config,
    );
    const ids = rows.map((r) => r.driverId);
    const approved = await this.approvedDrivers(ids);
    const ride = await this.rideFilters({ vehicleType, womenDriverOnly }, ids);
    const now = Date.now();
    const choice = chooseCandidate(
      rows.map((r): DispatchCandidate => ({
        driverId: r.driverId,
        distanceMeters: Math.round(r.distance),
        positionAgeSeconds: (now - r.locationAt.getTime()) / 1000,
        approved: approved.has(r.driverId),
        busy: r.busy,
        alreadyTried: false,
        onlineSince: (r.onlineSince ?? r.locationAt).toISOString(),
        vehicleOk: ride.vehicleOk.has(r.driverId),
        preferenceOk: !womenDriverOnly || ride.women.has(r.driverId),
      })),
      config,
    );
    if (!choice.chosen) return { drivers: 0, pickupEtaSeconds: null };
    const row = rows.find((r) => r.driverId === choice.chosen!.driverId)!;
    const eta = await this.routes.route({ lat: row.lat, lng: row.lng }, pickup).catch(() => null);
    return { drivers: choice.eligible, pickupEtaSeconds: eta?.durationSeconds ?? null };
  }

  /** O que o motorista pode saber do passageiro antes de aceitar: primeiro nome e nota. Nunca telefone. */
  async passengerOf(delivery: Delivery) {
    if (delivery.kind !== 'CORRIDA') return null;
    const [user, rating] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: delivery.clientId }, select: { name: true } }),
      this.ratings.summary(delivery.clientId, 'MOTORISTA_AVALIA_CLIENTE'),
    ]);
    return { firstName: firstName(user?.name), rating };
  }

  private async approvedDrivers(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    // Conta bloqueada não recebe oferta, mesmo com documentos aprovados.
    const blocked = new Set(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids }, blockedAt: { not: null } },
          select: { id: true },
        })
      ).map((u) => u.id),
    );
    for (const id of ids) {
      if (blocked.has(id)) continue;
      if ((await this.presence.approvalOf(id)).status === 'APROVADO') out.add(id);
    }
    return out;
  }

  private async associationRateOf(userId: string): Promise<number> {
    const p = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { associationRate: true },
    });
    return p?.associationRate ?? 0;
  }

  private async logNoCandidates(
    deliveryId: string,
    inRadius: number,
    excluded: Partial<Record<DispatchReason, number>>,
    config: DispatchConfig,
  ) {
    const last = await this.prisma.deliveryEvent.findFirst({
      where: { deliveryId, type: 'SEM_CANDIDATOS' },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < NO_CANDIDATES_LOG_EVERY_MS) return;
    await this.prisma.$transaction((tx) =>
      recordEvent(tx, {
        deliveryId,
        type: 'SEM_CANDIDATOS',
        reason: 'SEM_CANDIDATOS' satisfies DispatchReason,
        data: { inRadius, excluded, radiusMeters: config.radiusMeters },
      }),
    );
  }

  // ---------------------------------------------------------------- respostas do motorista

  async accept(driverId: string, offerId: string) {
    const offer = await this.ownOffer(driverId, offerId);
    if (offer.status !== 'PENDENTE')
      throw new ConflictException('Esta oferta não está mais disponível');
    if (offer.expiresAt.getTime() <= Date.now()) {
      await this.closeOffer(offerId, 'EXPIRADA', 'EXPIROU');
      throw new ConflictException('Oferta expirada');
    }
    // Corrida: o veículo que atende precisa continuar válido (documento pode ter vencido desde a oferta).
    const vehicleId = await this.rideVehicleFor(driverId, offer.deliveryId);
    const delivery = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.deliveryOffer.updateMany({
        where: { id: offerId, status: 'PENDENTE', expiresAt: { gt: now } },
        data: { status: 'ACEITA', respondedAt: now },
      });
      if (claimed.count === 0) throw new ConflictException('Esta oferta não está mais disponível');
      const moved = await moveStatus(tx, {
        id: offer.deliveryId,
        from: 'OFERECIDO',
        to: 'ACEITO',
        // Ninguém atende o próprio pedido (quem tem os dois papéis poderia gerar repasse e cotas para si).
        where: { clientId: { not: driverId } },
        data: { workerId: driverId, acceptedAt: now, ...(vehicleId ? { vehicleId } : {}) },
        actorId: driverId,
      });
      if (!moved) throw new ConflictException('O pedido não está mais disponível');
      await recordEvent(tx, {
        deliveryId: offer.deliveryId,
        type: 'ACEITE',
        actorId: driverId,
        reason: 'ACEITOU' satisfies DispatchReason,
        data: { offerId },
      });
      return tx.delivery.findUniqueOrThrow({ where: { id: offer.deliveryId } });
    });
    this.realtime.sendToUser(delivery.clientId, 'delivery.updated', {
      id: delivery.id,
      status: 'ACEITO',
    });
    return delivery;
  }

  /** Veículo (id) que atende a corrida; null para entregas. Lança 409 se o motorista não tem nenhum. */
  private async rideVehicleFor(driverId: string, deliveryId: string): Promise<string | null> {
    const d = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { kind: true, vehicleType: true },
    });
    if (d?.kind !== 'CORRIDA') return null;
    const { rules } = await this.municipal.current();
    const list = (await this.municipal.evaluateDriver([driverId], rules)).get(driverId) ?? [];
    const v = list.find((x) => x.type === d.vehicleType && x.eligibility.eligible);
    if (!v)
      throw new ConflictException(
        'Nenhum veículo seu atende às regras desta corrida. Confira seus documentos na aba Conta.',
      );
    return v.vehicleId;
  }

  /** Recusar é sempre livre e não deixa marca nenhuma além do registro desta oferta. */
  async decline(driverId: string, offerId: string, reason?: DeclineReason) {
    const offer = await this.ownOffer(driverId, offerId);
    if (offer.status !== 'PENDENTE')
      throw new ConflictException('Esta oferta não está mais disponível');
    const closed = await this.closeOffer(offerId, 'RECUSADA', 'RECUSOU', reason);
    if (!closed) throw new ConflictException('Esta oferta não está mais disponível');
  }

  /** Fecha uma oferta pendente, devolve o pedido a CRIADO, registra o motivo e oferece ao próximo. */
  async closeOffer(
    offerId: string,
    status: 'RECUSADA' | 'EXPIRADA',
    reason: Extract<DispatchReason, 'RECUSOU' | 'EXPIROU' | 'FICOU_OFFLINE'>,
    declineReason?: string,
  ): Promise<boolean> {
    const done = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.deliveryOffer.updateMany({
        where: { id: offerId, status: 'PENDENTE' },
        data: { status, respondedAt: new Date(), declineReason },
      });
      if (claimed.count === 0) return null;
      const offer = await tx.deliveryOffer.findUniqueOrThrow({ where: { id: offerId } });
      await moveStatus(tx, {
        id: offer.deliveryId,
        from: 'OFERECIDO',
        to: 'CRIADO',
        reason,
        actorId: offer.driverId,
      });
      await recordEvent(tx, {
        deliveryId: offer.deliveryId,
        type: status === 'RECUSADA' ? 'RECUSA' : 'EXPIRACAO',
        actorId: offer.driverId,
        reason,
        data: { offerId, ...(declineReason ? { declineReason } : {}) },
      });
      return offer;
    });
    if (!done) return false;
    this.realtime.sendToUser(done.driverId, 'offer.closed', { offerId, reason });
    await this.dispatch(done.deliveryId).catch((e: Error) =>
      this.logger.error(`Falha ao redespachar ${done.deliveryId}: ${e.message}`),
    );
    return true;
  }

  /** Motorista ficou offline: ofertas pendentes dele passam ao próximo, sem punição. */
  async dropPendingOffers(driverId: string) {
    const pending = await this.prisma.deliveryOffer.findMany({
      where: { driverId, status: 'PENDENTE' },
      select: { id: true },
    });
    for (const o of pending) await this.closeOffer(o.id, 'EXPIRADA', 'FICOU_OFFLINE');
  }

  /** Motorista aceitou mas não consegue seguir: o pedido volta à fila (antes de coletar). */
  async release(driverId: string, deliveryId: string, category?: string) {
    const ok = await this.prisma.$transaction(async (tx) => {
      const d = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!d || d.workerId !== driverId) throw new NotFoundException('Pedido não encontrado');
      if (d.status !== 'ACEITO' && d.status !== 'A_CAMINHO_COLETA')
        throw new ConflictException('Só é possível liberar o pedido antes de coletar');
      const moved = await moveStatus(tx, {
        id: d.id,
        from: d.status,
        to: 'CRIADO',
        where: { workerId: driverId },
        data: { workerId: null, acceptedAt: null, vehicleId: null },
        actorId: driverId,
        reason: 'DESISTIU' satisfies DispatchReason,
      });
      if (!moved) throw new ConflictException('O pedido mudou de estado; tente novamente');
      await recordEvent(tx, {
        deliveryId: d.id,
        type: 'DESISTENCIA',
        actorId: driverId,
        reason: 'DESISTIU' satisfies DispatchReason,
        data: category ? { category } : undefined,
      });
      return d;
    });
    this.realtime.sendToUser(ok.clientId, 'delivery.updated', { id: ok.id, status: 'CRIADO' });
    await this.dispatch(deliveryId).catch((e: Error) =>
      this.logger.error(`Falha ao redespachar ${deliveryId}: ${e.message}`),
    );
  }

  currentOffer(driverId: string) {
    return this.prisma.deliveryOffer
      .findFirst({
        where: { driverId, status: 'PENDENTE', expiresAt: { gt: new Date() } },
        include: { delivery: true },
      })
      .then(async (o) =>
        o
          ? offerView(
              o,
              o.delivery,
              await this.associationRateOf(driverId),
              await this.passengerOf(o.delivery),
            )
          : null,
      );
  }

  private async ownOffer(driverId: string, offerId: string) {
    const offer = await this.prisma.deliveryOffer.findUnique({ where: { id: offerId } });
    // Oferta de outro motorista é "não encontrada": não revela que existe.
    if (!offer || offer.driverId !== driverId) throw new NotFoundException('Oferta não encontrada');
    return offer;
  }

  // ---------------------------------------------------------------- rotina periódica

  /** Expira ofertas vencidas e tenta despachar pedidos parados em CRIADO. Idempotente. */
  async tick(): Promise<void> {
    const expired = await this.prisma.deliveryOffer.findMany({
      where: { status: 'PENDENTE', expiresAt: { lte: new Date() } },
      select: { id: true },
      take: 200,
    });
    for (const o of expired) await this.closeOffer(o.id, 'EXPIRADA', 'EXPIROU');

    const waiting = await this.prisma.delivery.findMany({
      // Pix ainda não pago fica de fora (canDispatch); pedido sem pagamento segue livre.
      where: {
        status: 'CRIADO',
        OR: [{ payment: { is: null } }, { payment: { is: { status: 'PAGO' } } }],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const d of waiting) {
      try {
        await this.dispatch(d.id);
      } catch (e) {
        this.logger.error(`Falha ao despachar ${d.id}: ${(e as Error).message}`);
      }
    }
  }
}
