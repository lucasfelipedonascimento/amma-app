import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LOCATION_CONSENT_VERSION,
  businessDay,
  compareWithCompetitor,
  sumDeliveries,
  weekByDay,
  type AssociationRate,
  type GeoPoint,
  type SettledDelivery,
} from '@amma/shared';
import type { Delivery } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ROUTE_PROVIDER, type RouteProvider } from '../routing/route-provider';

const HISTORY_LIMIT = 30;
/** Cobre os 7 dias corridos no fuso do negócio com folga. */
const WEEK_LOOKBACK_MS = 8 * 86_400_000;

const toSettled = (d: Delivery): SettledDelivery => ({
  deliveredAt: d.deliveredAt!.toISOString(),
  fareCents: d.fareCents,
  platformFeeCents: d.platformFeeCents ?? 0,
  associationFeeCents: d.associationFeeCents ?? 0,
  workerNetCents: d.workerNetCents ?? 0,
});

/** Telas do app do motorista que não cabem nos outros serviços: ganhos, rota e consentimento. */
@Injectable()
export class DriverAppService {
  private readonly logger = new Logger('DriverApp');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ROUTE_PROVIDER) private readonly routes: RouteProvider,
  ) {}

  /** Ganhos de hoje, da semana (7 dias, dia a dia) e histórico, sempre sobre entregas concluídas. */
  async earnings(driverId: string, now = new Date()) {
    const [recent, history, profile] = await Promise.all([
      this.prisma.delivery.findMany({
        where: {
          workerId: driverId,
          status: 'ENTREGUE',
          deliveredAt: { gte: new Date(now.getTime() - WEEK_LOOKBACK_MS) },
        },
        orderBy: { deliveredAt: 'desc' },
      }),
      this.prisma.delivery.findMany({
        where: { workerId: driverId, status: 'ENTREGUE', deliveredAt: { not: null } },
        orderBy: { deliveredAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
      this.prisma.driverProfile.findUnique({
        where: { userId: driverId },
        select: { associationRate: true },
      }),
    ]);

    const settled = recent.map(toSettled);
    const days = weekByDay(settled, now);
    const todayKey = businessDay(now);
    const weekRows = settled.filter((d) => days.some((x) => x.date === businessDay(d.deliveredAt)));
    const withComparison = <T extends { grossCents: number; netCents: number }>(t: T) => ({
      ...t,
      ...compareWithCompetitor(t.grossCents, t.netCents),
    });

    return {
      associationRate: (profile?.associationRate ?? 0) as AssociationRate,
      today: withComparison(
        sumDeliveries(settled.filter((d) => businessDay(d.deliveredAt) === todayKey)),
      ),
      week: { days, ...withComparison(sumDeliveries(weekRows)) },
      history: history.map((d) => ({
        id: d.id,
        deliveredAt: d.deliveredAt,
        pickupAddress: d.pickupAddress,
        dropoffAddress: d.dropoffAddress,
        fareCents: d.fareCents,
        platformFeeCents: d.platformFeeCents ?? 0,
        associationFeeCents: d.associationFeeCents ?? 0,
        workerNetCents: d.workerNetCents ?? 0,
        associationRate: d.associationRate ?? 0,
      })),
    };
  }

  /**
   * Rota da posição atual do motorista até o próximo ponto (coleta antes de coletar, entrega
   * depois). A posição vem do app (GPS do aparelho), então nada é lido do Redis aqui.
   */
  async route(driverId: string, deliveryId: string, from: GeoPoint) {
    const d = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!d || d.workerId !== driverId) throw new NotFoundException('Pedido não encontrado');
    const toPickup = d.status === 'ACEITO' || d.status === 'A_CAMINHO_COLETA';
    const toDropoff = d.status === 'COLETADO' || d.status === 'A_CAMINHO_ENTREGA';
    if (!toPickup && !toDropoff) throw new ConflictException('Este pedido não está em andamento');
    const destination = toPickup
      ? { lat: d.pickupLat, lng: d.pickupLng, address: d.pickupAddress }
      : { lat: d.dropoffLat, lng: d.dropoffLng, address: d.dropoffAddress };
    const r = await this.routes.route(from, destination, { withPath: true }).catch((e: Error) => {
      this.logger.warn(`Rota indisponível: ${e.message}`);
      throw new ServiceUnavailableException('Não foi possível traçar a rota agora');
    });
    return {
      target: toPickup ? ('COLETA' as const) : ('ENTREGA' as const),
      destination,
      distanceMeters: r.distanceMeters,
      durationSeconds: r.durationSeconds,
      path: r.path ?? [from, destination],
    };
  }

  // ---------------------------------------------------------------- consentimento de localização

  async locationConsent(userId: string) {
    const row = await this.prisma.consent.findFirst({
      where: { userId, type: 'LOCALIZACAO_SEGUNDO_PLANO', version: LOCATION_CONSENT_VERSION },
      orderBy: { acceptedAt: 'desc' },
    });
    return {
      version: LOCATION_CONSENT_VERSION,
      granted: !!row,
      grantedAt: row?.acceptedAt ?? null,
    };
  }

  async grantLocationConsent(userId: string) {
    const current = await this.locationConsent(userId);
    if (!current.granted)
      await this.prisma.consent.create({
        data: {
          userId,
          type: 'LOCALIZACAO_SEGUNDO_PLANO',
          version: LOCATION_CONSENT_VERSION,
        },
      });
    return this.locationConsent(userId);
  }

  /** Revogar apaga os registros deste consentimento (o app para de ler a localização). */
  async revokeLocationConsent(userId: string) {
    await this.prisma.consent.deleteMany({
      where: { userId, type: 'LOCALIZACAO_SEGUNDO_PLANO' },
    });
  }
}
