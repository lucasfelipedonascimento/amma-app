import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AMENITIES,
  POINT_TYPES,
  approximatePoint,
  hasHost,
  haversineMeters,
  initialPointStatus,
  isOpenAt,
  matchesFilter,
  missingChecklistItems,
  needsApproval,
  ratingSummary,
  validateHours,
  type Amenity,
  type OpeningHours,
  type PointType,
} from '@amma/shared';
import { Prisma, type WelcomePoint } from '@prisma/client';
import { EXTENSION, hasActivePdfContent, sniffMime } from '../common/file-type';
import { StorageService } from '../common/storage.service';
import { MAX_UPLOAD_BYTES } from '../driver/driver.service';
import { PrismaService } from '../prisma.service';
import { CreatePointDto, PointListQuery, UpdatePointDto } from './dto';
import { closeExpiredCheckIns } from './expiry';

export const MAX_POINT_PHOTOS = 6;
const MAX_LIVE_POINTS_PER_USER = 10;
const MAX_NEW_POINTS_PER_DAY = 3;
const DUPLICATE_RADIUS_METERS = 30;
const LIST_LIMIT = 100;
/** Estados em que o ponto ainda "existe" para o dono (conta no limite e aceita edição). */
const LIVE = ['EM_ANALISE', 'ATIVO', 'SUSPENSO'] as const;

export interface Viewer {
  id: string;
  isAdmin: boolean;
}

type PointWithPhotos = WelcomePoint & { photos: { id: string }[] };
const PHOTOS = { photos: { select: { id: true }, orderBy: { createdAt: 'asc' as const } } };

/**
 * Pontos de acolhida: cadastro, edição, fotos, mapa com filtros e a visão de cada pessoa.
 * A casa parceira é a casa de alguém: o mapa só mostra bairro e posição aproximada; o endereço
 * completo vai ao dono, ao admin e a quem está com check-in aberto lá.
 */
@Injectable()
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  rules() {
    return {
      types: POINT_TYPES,
      amenities: AMENITIES,
      capacityMax: 50,
      maxPhotos: MAX_POINT_PHOTOS,
    };
  }

  // ------------------------------------------------------------------ cadastro

  async create(user: Viewer, dto: CreatePointDto) {
    const hoursProblem = validateHours(dto.hours);
    if (hoursProblem) throw new BadRequestException(hoursProblem);

    if (needsApproval(dto.type)) {
      const missing = missingChecklistItems(dto.checklist);
      if (missing.length > 0)
        throw new BadRequestException(
          `Confirme todos os itens do checklist de segurança (faltam: ${missing.join(', ')})`,
        );
    } else if (dto.checklist) {
      throw new BadRequestException('O checklist de segurança é só da casa parceira');
    }

    const [live, today, nearby] = await Promise.all([
      this.prisma.welcomePoint.count({ where: { ownerId: user.id, status: { in: [...LIVE] } } }),
      this.prisma.welcomePoint.count({
        where: { ownerId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),
      this.prisma.welcomePoint.findMany({
        where: {
          status: { in: [...LIVE] },
          lat: { gte: dto.lat - 0.001, lte: dto.lat + 0.001 },
          lng: { gte: dto.lng - 0.001, lte: dto.lng + 0.001 },
        },
        select: { lat: true, lng: true, type: true },
      }),
    ]);
    if (live >= MAX_LIVE_POINTS_PER_USER)
      throw new ConflictException(`Você já tem ${MAX_LIVE_POINTS_PER_USER} pontos cadastrados`);
    if (today >= MAX_NEW_POINTS_PER_DAY)
      throw new ConflictException('Limite de novos pontos por dia atingido. Tente amanhã.');
    if (
      nearby.some(
        (p) =>
          p.type === dto.type &&
          haversineMeters(p, { lat: dto.lat, lng: dto.lng }) <= DUPLICATE_RADIUS_METERS,
      )
    )
      throw new ConflictException('Já existe um ponto deste tipo neste local');

    const status = initialPointStatus(dto.type);
    const point = await this.prisma.welcomePoint.create({
      data: {
        ownerId: user.id,
        type: dto.type,
        status,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        address: dto.address.trim(),
        neighborhood: dto.neighborhood.trim(),
        reference: dto.reference?.trim() || null,
        lat: dto.lat,
        lng: dto.lng,
        hours: dto.hours as Prisma.InputJsonValue,
        amenities: dto.amenities,
        capacity: dto.capacity,
        benefitKind: dto.benefitKind ?? 'CREDITO',
        checklist: needsApproval(dto.type) ? (dto.checklist as Prisma.InputJsonValue) : undefined,
        events: {
          create: {
            actorId: user.id,
            toStatus: status,
            note: needsApproval(dto.type) ? 'Enviada para análise da associação' : 'Cadastrado',
          },
        },
      },
      include: PHOTOS,
    });
    return this.view(point, user, {});
  }

  async update(user: Viewer, id: string, dto: UpdatePointDto) {
    const point = await this.ownedLive(user, id);
    if (dto.hours !== undefined) {
      const problem = validateHours(dto.hours);
      if (problem) throw new BadRequestException(problem);
    }
    const updated = await this.prisma.welcomePoint.update({
      where: { id: point.id },
      data: {
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        reference: dto.reference === undefined ? undefined : dto.reference.trim() || null,
        hours: dto.hours as Prisma.InputJsonValue | undefined,
        amenities: dto.amenities,
        capacity: dto.capacity,
        benefitKind: dto.benefitKind,
      },
      include: PHOTOS,
    });
    return this.view(updated, user, {});
  }

  /** O dono tira o ponto do ar. Quem estava lá com check-in aberto é liberado. */
  async removeOwn(user: Viewer, id: string) {
    const point = await this.ownedLive(user, id);
    const photos = await this.prisma.welcomePointPhoto.findMany({
      where: { pointId: point.id },
      select: { storageKey: true },
    });
    await this.prisma.$transaction([
      this.prisma.welcomePoint.update({
        where: { id: point.id },
        data: { status: 'REMOVIDO', statusNote: 'Removido pelo anfitrião' },
      }),
      this.prisma.pointEvent.create({
        data: {
          pointId: point.id,
          actorId: user.id,
          fromStatus: point.status,
          toStatus: 'REMOVIDO',
          note: 'Removido pelo próprio cadastrante',
        },
      }),
      this.prisma.checkIn.updateMany({
        where: { pointId: point.id, endedAt: null },
        data: { endedAt: new Date() },
      }),
      this.prisma.welcomePointPhoto.deleteMany({ where: { pointId: point.id } }),
    ]);
    await Promise.all(photos.map((p) => this.storage.remove(p.storageKey)));
  }

  // ------------------------------------------------------------------ fotos

  async addPhoto(user: Viewer, id: string, file: { buffer: Buffer; size: number } | undefined) {
    const point = await this.ownedLive(user, id);
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Foto maior que 5 MB');
    const mime = sniffMime(file.buffer);
    if (mime === 'application/pdf' && hasActivePdfContent(file.buffer))
      throw new BadRequestException(
        'O PDF tem conteúdo ativo (scripts ou arquivos embutidos) e não é aceito.',
      );
    if (mime !== 'image/jpeg' && mime !== 'image/png')
      throw new BadRequestException('Formato não suportado. Envie JPG ou PNG.');
    const count = await this.prisma.welcomePointPhoto.count({ where: { pointId: point.id } });
    if (count >= MAX_POINT_PHOTOS)
      throw new ConflictException(`Máximo de ${MAX_POINT_PHOTOS} fotos por ponto`);
    const storageKey = await this.storage.save(file.buffer, EXTENSION[mime]);
    const photo = await this.prisma.welcomePointPhoto.create({
      data: { pointId: point.id, storageKey, mimeType: mime, sizeBytes: file.size },
    });
    return { id: photo.id };
  }

  async removePhoto(user: Viewer, id: string, photoId: string) {
    const point = await this.ownedLive(user, id);
    const photo = await this.prisma.welcomePointPhoto.findFirst({
      where: { id: photoId, pointId: point.id },
    });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    await this.prisma.welcomePointPhoto.delete({ where: { id: photo.id } });
    await this.storage.remove(photo.storageKey);
  }

  async photoFile(user: Viewer, id: string, photoId: string) {
    const point = await this.prisma.welcomePoint.findUnique({ where: { id } });
    if (!point || !(await this.canSee(user, point)))
      throw new NotFoundException('Foto não encontrada');
    const photo = await this.prisma.welcomePointPhoto.findFirst({
      where: { id: photoId, pointId: id },
    });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    return { data: await this.storage.read(photo.storageKey), mimeType: photo.mimeType };
  }

  // ------------------------------------------------------------------ mapa

  /** Pontos ATIVOS ao redor, com os filtros, do mais perto para o mais longe. */
  async list(user: Viewer, q: PointListQuery) {
    const radius = q.radiusMeters ?? 5000;
    const dLat = radius / 111_000;
    const dLng = radius / (111_000 * Math.max(0.2, Math.cos((q.lat * Math.PI) / 180)));
    const types = q.types?.split(',') ?? [];
    const amenities = q.amenities?.split(',') ?? [];
    if (types.some((t) => !POINT_TYPES.includes(t as PointType)))
      throw new BadRequestException('Tipo de ponto inválido');
    if (amenities.some((a) => !AMENITIES.includes(a as Amenity)))
      throw new BadRequestException('Comodidade inválida');

    await closeExpiredCheckIns(this.prisma);
    const rows = await this.prisma.welcomePoint.findMany({
      where: {
        status: 'ATIVO',
        lat: { gte: q.lat - dLat, lte: q.lat + dLat },
        lng: { gte: q.lng - dLng, lte: q.lng + dLng },
        ...(types.length ? { type: { in: types as PointType[] } } : {}),
        ...(amenities.length ? { amenities: { hasEvery: amenities as Amenity[] } } : {}),
      },
      include: PHOTOS,
    });
    const [stats, occupied] = await Promise.all([
      this.ratingStats(rows.map((r) => r.id)),
      this.occupancy(rows.map((r) => r.id)),
    ]);
    const origin = { lat: q.lat, lng: q.lng };
    const now = new Date();
    const out = rows
      .map((r) => {
        const shown = this.shownPosition(r, false);
        return { r, shown, distance: haversineMeters(origin, shown) };
      })
      .filter(({ r, distance }) => {
        if (distance > radius) return false;
        return matchesFilter(
          {
            type: r.type,
            amenities: r.amenities,
            hours: r.hours as unknown as OpeningHours,
            average: ratingSummary(stats.get(r.id) ?? []).average,
          },
          {
            types: types as PointType[],
            amenities: amenities as Amenity[],
            openNow: q.openNow === 'true',
            minRating: q.minRating,
          },
          now,
        );
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, LIST_LIMIT);
    return out.map(({ r, distance }) =>
      this.view(r, user, {
        distanceMeters: distance,
        stars: stats.get(r.id),
        occupied: occupied.get(r.id) ?? 0,
        now,
      }),
    );
  }

  async get(user: Viewer, id: string, origin?: { lat?: number; lng?: number }) {
    await closeExpiredCheckIns(this.prisma);
    const point = await this.prisma.welcomePoint.findUnique({ where: { id }, include: PHOTOS });
    if (!point || !(await this.canSee(user, point)))
      throw new NotFoundException('Ponto não encontrado');
    const [stats, occupied, atPoint] = await Promise.all([
      this.ratingStats([id]),
      this.occupancy([id]),
      this.prisma.checkIn.findFirst({ where: { pointId: id, userId: user.id, endedAt: null } }),
    ]);
    const shown = this.shownPosition(point, !!atPoint || this.privileged(user, point));
    const distanceMeters =
      origin?.lat !== undefined && origin?.lng !== undefined
        ? haversineMeters({ lat: origin.lat, lng: origin.lng }, shown)
        : undefined;
    return this.view(point, user, {
      distanceMeters,
      stars: stats.get(id),
      occupied: occupied.get(id) ?? 0,
      atPoint: !!atPoint,
    });
  }

  async mine(user: Viewer) {
    await closeExpiredCheckIns(this.prisma);
    const rows = await this.prisma.welcomePoint.findMany({
      where: { ownerId: user.id, status: { not: 'REMOVIDO' } },
      orderBy: { createdAt: 'desc' },
      include: PHOTOS,
    });
    const [stats, occupied] = await Promise.all([
      this.ratingStats(rows.map((r) => r.id)),
      this.occupancy(rows.map((r) => r.id)),
    ]);
    return rows.map((r) =>
      this.view(r, user, { stars: stats.get(r.id), occupied: occupied.get(r.id) ?? 0 }),
    );
  }

  // ------------------------------------------------------------------ apoio (usado também por outros serviços)

  /** Notas que os visitantes deram a cada ponto. */
  async ratingStats(pointIds: string[]): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    if (pointIds.length === 0) return map;
    const rows = await this.prisma.pointRating.findMany({
      where: { direction: 'VISITANTE_AVALIA_PONTO', checkIn: { pointId: { in: pointIds } } },
      select: { stars: true, checkIn: { select: { pointId: true } } },
    });
    for (const r of rows) {
      const list = map.get(r.checkIn.pointId) ?? [];
      list.push(r.stars);
      map.set(r.checkIn.pointId, list);
    }
    return map;
  }

  /** Quantas pessoas estão no ponto agora. */
  async occupancy(pointIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.checkIn.groupBy({
      by: ['pointId'],
      where: { pointId: { in: pointIds }, endedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.pointId, r._count._all]));
  }

  private privileged(user: Viewer, p: WelcomePoint) {
    return user.isAdmin || p.ownerId === user.id;
  }

  private async canSee(user: Viewer, p: WelcomePoint): Promise<boolean> {
    if (this.privileged(user, p)) return true;
    return p.status === 'ATIVO';
  }

  private shownPosition(p: WelcomePoint, exact: boolean) {
    const real = { lat: p.lat, lng: p.lng };
    return p.type === 'CASA_PARCEIRA' && !exact ? approximatePoint(real) : real;
  }

  private async ownedLive(user: Viewer, id: string): Promise<WelcomePoint> {
    const point = await this.prisma.welcomePoint.findUnique({ where: { id } });
    if (!point || point.ownerId !== user.id) throw new NotFoundException('Ponto não encontrado');
    if (!(LIVE as readonly string[]).includes(point.status))
      throw new ConflictException('Este ponto não está mais cadastrado');
    return point;
  }

  /** A visão de um ponto para quem pede: o dono e o admin veem tudo; os demais, o que o mapa pode mostrar. */
  view(
    p: PointWithPhotos,
    user: Viewer,
    ctx: {
      distanceMeters?: number;
      stars?: number[];
      occupied?: number;
      atPoint?: boolean;
      now?: Date;
    },
  ) {
    const privileged = this.privileged(user, p);
    const exact = privileged || !!ctx.atPoint;
    const position = this.shownPosition(p, exact);
    const hours = p.hours as unknown as OpeningHours;
    const rating = ratingSummary(ctx.stars ?? []);
    return {
      id: p.id,
      type: p.type,
      name: p.name,
      description: p.description,
      neighborhood: p.neighborhood,
      // Casa de alguém: rua e número só para o dono, o admin e quem está lá.
      address: p.type === 'CASA_PARCEIRA' && !exact ? null : p.address,
      reference: p.type === 'CASA_PARCEIRA' && !exact ? null : p.reference,
      lat: position.lat,
      lng: position.lng,
      approximate: p.type === 'CASA_PARCEIRA' && !exact,
      hours,
      openNow: isOpenAt(hours, ctx.now ?? new Date()),
      amenities: p.amenities,
      capacity: p.capacity,
      occupied: ctx.occupied ?? 0,
      photos: p.photos.map((x) => x.id),
      rating,
      hasHost: hasHost(p.type),
      isOwner: p.ownerId === user.id,
      ...(ctx.distanceMeters !== undefined ? { distanceMeters: ctx.distanceMeters } : {}),
      ...(privileged
        ? {
            status: p.status,
            statusNote: p.statusNote,
            benefitKind: p.benefitKind,
            checklist: p.checklist,
          }
        : {}),
    };
  }
}
