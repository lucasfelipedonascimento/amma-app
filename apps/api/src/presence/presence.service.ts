import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  ACTIVE_DRIVER_STATUSES,
  driverApproval,
  type GeoPoint,
  type DriverApproval,
} from '@amma/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PositionStore } from './position-store';

type Db = PrismaService | Prisma.TransactionClient;

/** Motorista online/offline e posição em tempo real (Redis + PostGIS). */
@Injectable()
export class PresenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PositionStore,
  ) {}

  /** Situação de aprovação a partir do último envio de cada documento. */
  async approvalOf(userId: string, db: Db = this.prisma): Promise<DriverApproval> {
    const docs = await db.document.findMany({
      where: { userId },
      select: { type: true, status: true, createdAt: true },
    });
    return driverApproval(docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })));
  }

  /** Só motorista APROVADO fica online. Idempotente: chamar de novo só atualiza a posição. */
  async goOnline(userId: string, point: GeoPoint) {
    const approval = await this.approvalOf(userId);
    if (approval.status !== 'APROVADO')
      throw new ForbiddenException({
        message: 'Cadastro ainda não aprovado. Conclua o envio e a análise dos documentos.',
        approval,
      });
    const now = new Date();
    const current = await this.prisma.driverPresence.findUnique({ where: { userId } });
    await this.prisma.driverPresence.upsert({
      where: { userId },
      create: { userId, online: true, onlineSince: now },
      update: { online: true, onlineSince: current?.online ? current.onlineSince : now },
    });
    await this.store.setOnline(userId, true);
    await this.recordPosition(userId, point, now, true);
    return this.status(userId);
  }

  /**
   * Fica offline. Bloqueado com entrega em andamento (o cliente ficaria sem motorista); uma oferta
   * pendente é encerrada sem punição por quem chama (ver DispatchService.dropPendingOffers).
   */
  async goOffline(userId: string) {
    const active = await this.prisma.delivery.count({
      where: { workerId: userId, status: { in: [...ACTIVE_DRIVER_STATUSES] } },
    });
    if (active > 0)
      throw new ConflictException(
        'Conclua ou libere a entrega em andamento antes de ficar offline',
      );
    await this.prisma.$executeRaw`
      UPDATE "DriverPresence"
      SET online = false, "onlineSince" = NULL, location = NULL, "locationAt" = NULL, "updatedAt" = now()
      WHERE "userId" = ${userId}`;
    // Sem rastro: a posição é apagada ao ficar offline (LGPD, minimização).
    await this.store.remove(userId);
  }

  /** Offline sem as travas de `goOffline` (revogação de consentimento: não depende de entrega em andamento). */
  async forceOffline(userId: string) {
    await this.prisma.$executeRaw`
      UPDATE "DriverPresence"
      SET online = false, "onlineSince" = NULL, location = NULL, "locationAt" = NULL, "updatedAt" = now()
      WHERE "userId" = ${userId}`;
    await this.store.remove(userId);
  }

  /**
   * Posição recebida pelo WebSocket. Sempre vai para o Redis; o PostGIS recebe no máximo
   * uma gravação a cada PERSIST_EVERY_SECONDS. Retorna false se o motorista não está online.
   */
  async updatePosition(userId: string, point: GeoPoint): Promise<boolean> {
    if (!(await this.isOnline(userId))) return false;
    await this.recordPosition(userId, point, new Date(), false);
    return true;
  }

  private async isOnline(userId: string): Promise<boolean> {
    if (await this.store.isOnline(userId)) return true;
    // Redis não sabe (reiniciou, chave perdida): confirma no banco e recria a flag.
    const row = await this.prisma.driverPresence.findUnique({
      where: { userId },
      select: { online: true },
    });
    if (row?.online) await this.store.setOnline(userId, true);
    return !!row?.online;
  }

  private async recordPosition(userId: string, p: GeoPoint, at: Date, force: boolean) {
    await this.store.set(userId, { lat: p.lat, lng: p.lng, at: at.toISOString() });
    // `force` (entrar online) grava sempre e também abre a janela de limite de frequência.
    const claimed = await this.store.claimPersistSlot(userId);
    if (force || claimed) {
      await this.prisma.$executeRaw`
        UPDATE "DriverPresence"
        SET location = ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography,
            "locationAt" = ${at}, "updatedAt" = now()
        WHERE "userId" = ${userId} AND online = true`;
    }
  }

  /**
   * Última posição conhecida do motorista e há quantos segundos ela foi recebida. Redis primeiro; se
   * ele não souber (caiu ou expirou), usa a última gravada no PostGIS. `null` se não há posição.
   */
  async lastKnownPosition(userId: string): Promise<{ point: GeoPoint; ageSeconds: number } | null> {
    const hot = await this.store.get(userId);
    if (hot) {
      return {
        point: { lat: hot.lat, lng: hot.lng },
        ageSeconds: Math.max(0, (Date.now() - new Date(hot.at).getTime()) / 1000),
      };
    }
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number; at: Date }[]>`
      SELECT ST_Y(location::geometry)::float8 AS lat, ST_X(location::geometry)::float8 AS lng,
             "locationAt" AS at
      FROM "DriverPresence"
      WHERE "userId" = ${userId} AND online = true AND location IS NOT NULL AND "locationAt" IS NOT NULL`;
    const r = rows[0];
    if (!r) return null;
    return {
      point: { lat: r.lat, lng: r.lng },
      ageSeconds: Math.max(0, (Date.now() - r.at.getTime()) / 1000),
    };
  }

  async status(userId: string) {
    const row = await this.prisma.driverPresence.findUnique({ where: { userId } });
    const position = row?.online ? await this.store.get(userId) : null;
    return {
      online: row?.online ?? false,
      onlineSince: row?.onlineSince ?? null,
      position,
    };
  }
}
