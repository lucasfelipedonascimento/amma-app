import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_CLAIM_ATTACHMENTS,
  canMoveClaim,
  isClaimFinal,
  validateDecision,
  type ClaimStatus,
} from '@amma/shared';
import { type InsuranceAttachment, type InsuranceClaim, type InsuranceEvent } from '@prisma/client';
import { EXTENSION, sniffMime } from '../common/file-type';
import { StorageService } from '../common/storage.service';
import { MAX_UPLOAD_BYTES } from '../driver/driver.service';
import { PrismaService } from '../prisma.service';
import { ClaimDecisionDto, CreateClaimDto } from './dto';
import { MembersService } from './members.service';

type ClaimFull = InsuranceClaim & {
  attachments: InsuranceAttachment[];
  events: InsuranceEvent[];
};
const FULL = {
  attachments: { orderBy: { createdAt: 'asc' as const } },
  events: { orderBy: { createdAt: 'asc' as const } },
};

/**
 * Seguro mútuo. A decisão é sempre de uma pessoa da associação (admin), registrada com motivo,
 * e nunca do próprio sócio que pediu. Todo passo vira um evento imutável na linha do tempo.
 */
@Injectable()
export class InsuranceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ sócio

  async create(userId: string, dto: CreateClaimDto) {
    if (!(await this.members.isMember(userId)))
      throw new ForbiddenException('O seguro mútuo é para sócios (com ao menos 1 cota)');
    const occurredAt = new Date(dto.occurredAt);
    if (occurredAt.getTime() > Date.now())
      throw new BadRequestException('A data do ocorrido não pode ser no futuro');
    const claim = await this.prisma.insuranceClaim.create({
      data: {
        claimantId: userId,
        kind: dto.kind,
        occurredAt,
        description: dto.description.trim(),
        requestedCents: dto.requestedCents,
        events: { create: { actorId: userId, toStatus: 'ENVIADA' } },
      },
      include: FULL,
    });
    return this.view(claim);
  }

  async listMine(userId: string) {
    const rows = await this.prisma.insuranceClaim.findMany({
      where: { claimantId: userId },
      orderBy: { createdAt: 'desc' },
      include: FULL,
    });
    return rows.map((c) => this.view(c));
  }

  async getMine(userId: string, id: string) {
    return this.view(await this.ownedOrThrow(userId, id));
  }

  async attach(userId: string, id: string, file: { buffer: Buffer; size: number } | undefined) {
    const claim = await this.ownedOrThrow(userId, id);
    if (isClaimFinal(claim.status))
      throw new ConflictException('Este pedido já foi encerrado e não recebe mais anexos');
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Arquivo maior que 5 MB');
    const mime = sniffMime(file.buffer);
    if (!mime) throw new BadRequestException('Formato não suportado. Envie JPG, PNG ou PDF.');
    if (claim.attachments.length >= MAX_CLAIM_ATTACHMENTS)
      throw new ConflictException(`Máximo de ${MAX_CLAIM_ATTACHMENTS} anexos por pedido`);
    const storageKey = await this.storage.save(file.buffer, EXTENSION[mime]);
    const a = await this.prisma.insuranceAttachment.create({
      data: { claimId: id, storageKey, mimeType: mime, sizeBytes: file.size },
    });
    return this.attachmentView(a);
  }

  async cancel(userId: string, id: string) {
    const claim = await this.ownedOrThrow(userId, id);
    await this.move(claim, 'CANCELADA', userId, { note: 'Cancelado pelo sócio' });
    return this.getMine(userId, id);
  }

  async attachmentFile(userId: string, id: string, attachmentId: string, asAdmin = false) {
    const claim = asAdmin
      ? await this.prisma.insuranceClaim.findUnique({ where: { id }, include: FULL })
      : await this.ownedOrThrow(userId, id);
    const a = claim?.attachments.find((x) => x.id === attachmentId);
    if (!a) throw new NotFoundException('Anexo não encontrado');
    return { data: await this.storage.read(a.storageKey), mimeType: a.mimeType };
  }

  // ------------------------------------------------------------------ admin

  async listAll(status?: string) {
    const rows = await this.prisma.insuranceClaim.findMany({
      where: status ? { status: status as ClaimStatus } : undefined,
      orderBy: { createdAt: 'asc' },
      include: { ...FULL, claimant: { select: { name: true, phone: true } } },
    });
    return rows.map((c) => ({ ...this.view(c), claimant: c.claimant }));
  }

  async getAny(id: string) {
    const c = await this.prisma.insuranceClaim.findUnique({
      where: { id },
      include: { ...FULL, claimant: { select: { name: true, phone: true } } },
    });
    if (!c) throw new NotFoundException('Pedido não encontrado');
    return { ...this.view(c), claimant: c.claimant };
  }

  /** Assume a análise (ENVIADA → EM_ANALISE). Quem pediu não analisa o próprio pedido. */
  async startReview(adminId: string, id: string) {
    const claim = await this.anyOrThrow(id);
    this.assertNotClaimant(adminId, claim);
    await this.move(claim, 'EM_ANALISE', adminId, {});
    return this.getAny(id);
  }

  /** Decisão humana, com motivo. Só de pedido EM_ANALISE e nunca do próprio pedido. */
  async decide(adminId: string, id: string, dto: ClaimDecisionDto) {
    const claim = await this.anyOrThrow(id);
    this.assertNotClaimant(adminId, claim);
    const problem = validateDecision({
      decision: dto.decision,
      note: dto.note,
      requestedCents: claim.requestedCents,
      approvedCents: dto.approvedCents,
    });
    if (problem) throw new BadRequestException(problem);
    await this.move(claim, dto.decision, adminId, {
      note: dto.note.trim(),
      data: {
        decidedById: adminId,
        decidedAt: new Date(),
        decisionNote: dto.note.trim(),
        approvedCents: dto.decision === 'APROVADA' ? dto.approvedCents : null,
      },
    });
    return this.getAny(id);
  }

  // ------------------------------------------------------------------ internos

  /** Muda de estado e registra o evento na mesma transação; perde a corrida => 409. */
  private async move(
    claim: InsuranceClaim,
    to: ClaimStatus,
    actorId: string,
    opts: { note?: string; data?: Record<string, unknown> },
  ) {
    if (!canMoveClaim(claim.status, to))
      throw new ConflictException(`Não é possível ir de ${claim.status} para ${to}`);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.insuranceClaim.updateMany({
        where: { id: claim.id, status: claim.status },
        data: { status: to, ...opts.data },
      });
      if (r.count === 0)
        throw new ConflictException('O pedido mudou enquanto você o abria. Recarregue.');
      await tx.insuranceEvent.create({
        data: {
          claimId: claim.id,
          actorId,
          fromStatus: claim.status,
          toStatus: to,
          note: opts.note,
        },
      });
    });
  }

  private assertNotClaimant(adminId: string, claim: InsuranceClaim) {
    if (claim.claimantId === adminId)
      throw new ForbiddenException('Você não pode analisar nem decidir o seu próprio pedido');
  }

  private async ownedOrThrow(userId: string, id: string): Promise<ClaimFull> {
    const c = await this.prisma.insuranceClaim.findFirst({
      where: { id, claimantId: userId },
      include: FULL,
    });
    if (!c) throw new NotFoundException('Pedido não encontrado');
    return c;
  }

  private async anyOrThrow(id: string) {
    const c = await this.prisma.insuranceClaim.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Pedido não encontrado');
    return c;
  }

  private attachmentView(a: InsuranceAttachment) {
    return { id: a.id, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt };
  }

  private view(c: ClaimFull) {
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      occurredAt: c.occurredAt,
      description: c.description,
      requestedCents: c.requestedCents,
      approvedCents: c.approvedCents,
      decisionNote: c.decisionNote,
      decidedAt: c.decidedAt,
      createdAt: c.createdAt,
      attachments: c.attachments.map((a) => this.attachmentView(a)),
      timeline: c.events.map((e) => ({
        from: e.fromStatus,
        to: e.toStatus,
        note: e.note,
        at: e.createdAt,
      })),
    };
  }
}
