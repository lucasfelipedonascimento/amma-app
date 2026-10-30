import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ACTIVE_DRIVER_STATUSES,
  chooseCandidate,
  type DeclineReason,
  type DispatchCandidate,
  type DispatchConfig,
  type DispatchReason,
} from '@amma/shared';
import { type Delivery } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { RealtimeService } from '../realtime/realtime.service';
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
    @Inject(ROUTE_PROVIDER) private readonly routes: RouteProvider,
  ) {}

  // ---------------------------------------------------------------- escolha e oferta

  async dispatch(deliveryId: string): Promise<DispatchOutcome> {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== 'CRIADO') return 'SKIPPED';
    const config = await this.settings.get();

    if (Date.now() - delivery.createdAt.getTime() > config.maxSearchSeconds * 1000) {
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
      if (ok)
        this.realtime.sendToUser(delivery.clientId, 'delivery.updated', {
          id: delivery.id,
          status: 'CANCELADO',
          cancelReason: 'SEM_MOTORISTA',
        });
      return ok ? 'CANCELLED' : 'SKIPPED';
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const rows = await this.candidates(delivery, config);
      const approved = await this.approvedDrivers(rows.map((r) => r.driverId));
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
        this.realtime.sendToUser(
          chosen.driverId,
          'offer.created',
          offerView(offer, delivery, rate),
        );
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
  private candidates(delivery: Delivery, config: DispatchConfig): Promise<CandidateRow[]> {
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
      ORDER BY distance ASC
      LIMIT ${MAX_CANDIDATES}`;
  }

  private async approvedDrivers(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const id of ids) {
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
        data: { workerId: driverId, acceptedAt: now },
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
  async release(driverId: string, deliveryId: string) {
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
        data: { workerId: null, acceptedAt: null },
        actorId: driverId,
        reason: 'DESISTIU' satisfies DispatchReason,
      });
      if (!moved) throw new ConflictException('O pedido mudou de estado; tente novamente');
      await recordEvent(tx, {
        deliveryId: d.id,
        type: 'DESISTENCIA',
        actorId: driverId,
        reason: 'DESISTIU' satisfies DispatchReason,
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
        o ? offerView(o, o.delivery, await this.associationRateOf(driverId)) : null,
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
      where: { status: 'CRIADO' },
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
