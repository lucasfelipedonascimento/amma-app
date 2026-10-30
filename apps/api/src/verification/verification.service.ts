import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  evaluateVerification,
  VERIFIABLE_DOCUMENTS,
  type Finding,
  type ReaderAnalysis,
  type VerifiableDocument,
} from '@amma/shared';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma.service';
import { DOCUMENT_READER, DocumentReader } from './reader';

/** O que o painel vê da leitura automática (campos já mascarados). */
export const VERIFICATION_VIEW = {
  status: true,
  recommendation: true,
  findings: true,
  extracted: true,
  autoApproved: true,
  updatedAt: true,
} as const;

const last = (v: unknown, n: number) => {
  const s = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return s.length > n ? `***${s.slice(-n)}` : s ? '***' : null;
};
const maskCpf = (v: unknown) => {
  const s = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return s.length === 11 ? `***.${s.slice(3, 6)}.${s.slice(6, 9)}-**` : null;
};

/**
 * Só o que ajuda quem revisa e é preciso ser guardado. Nada de CPF/RENAVAM/registro inteiros, nem o texto lido:
 * o documento original já está guardado, com acesso restrito (docs/LGPD.md).
 */
export function maskExtracted(a: ReaderAnalysis): Prisma.InputJsonObject {
  const f = a.fields;
  if (a.kind === 'CNH')
    return {
      name: (f.name as string) ?? null,
      cpf: maskCpf(f.cpf),
      registration: last(f.registration, 4),
      category: (f.category as string) ?? null,
      validUntil: (f.validUntil as string) ?? null,
      hasEar: f.hasEar === true,
    };
  if (a.kind === 'CRLV')
    return {
      plate: (f.plate as string) ?? null,
      renavam: last(f.renavam, 4),
      yearModel: (f.yearModel as number) ?? null,
      exerciseYear: (f.exerciseYear as number) ?? null,
      ownerCpf: maskCpf(f.ownerCpf),
    };
  return {};
}

@Injectable()
export class VerificationService {
  private readonly log = new Logger('DocVerification');
  private readonly autoApprove: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService,
    @Optional() @Inject(DOCUMENT_READER) private readonly reader: DocumentReader | null,
  ) {
    this.autoApprove = config.get('DOC_AUTO_APPROVE') === 'true';
    if (this.autoApprove && !reader)
      throw new Error('DOC_AUTO_APPROVE=true exige DOC_READER_MODE=http');
  }

  get enabled(): boolean {
    return !!this.reader;
  }

  /** Dispara a leitura sem segurar o envio do motorista. Falha aqui nunca derruba o upload. */
  enqueue(documentId: string): void {
    if (!this.reader) return;
    void this.verify(documentId).catch((e) =>
      this.log.error(`verificação do documento ${documentId} falhou: ${(e as Error).message}`),
    );
  }

  /** Lê, confere com o cadastro e grava o resultado (refazer sobrescreve). Devolve null se não se aplica. */
  async verify(documentId: string) {
    if (!this.reader) return null;
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || !(VERIFIABLE_DOCUMENTS as readonly string[]).includes(doc.type)) return null;
    const type = doc.type as VerifiableDocument;

    const [profile, vehicle] = await Promise.all([
      this.prisma.driverProfile.findUnique({ where: { userId: doc.userId } }),
      doc.vehicleId
        ? this.prisma.vehicle.findUnique({ where: { id: doc.vehicleId } })
        : this.prisma.vehicle.findFirst({
            where: { userId: doc.userId },
            orderBy: { createdAt: 'asc' },
          }),
    ]);

    let analysis: ReaderAnalysis;
    try {
      analysis = await this.reader.analyze(await this.storage.read(doc.storageKey), type);
    } catch (e) {
      this.log.warn(`leitor indisponível para o documento ${documentId}: ${(e as Error).message}`);
      return this.save(documentId, {
        status: 'INDISPONIVEL',
        recommendation: null,
        findings: [
          {
            code: 'LEITOR',
            label: 'Leitura automática',
            level: 'ALERTA',
            detail: 'Indisponível no momento',
          },
        ],
        extracted: {},
        engine: null,
        autoApproved: false,
      });
    }

    const findings: Finding[] = profile
      ? evaluateVerification(analysis, {
          type,
          profile: {
            cpf: profile.cpf,
            fullName: profile.fullName,
            birthDate: profile.birthDate.toISOString().slice(0, 10),
          },
          vehicle: vehicle
            ? { plate: vehicle.plate, year: vehicle.year, type: vehicle.type }
            : undefined,
        }).findings
      : [
          {
            code: 'CADASTRO',
            label: 'Cadastro do motorista',
            level: 'ALERTA',
            detail: 'Dados pessoais ainda não preenchidos',
          },
        ];
    const recommendation = findings.every((f) => f.level === 'OK') ? 'APROVAR' : 'REVISAR';
    const auto =
      this.autoApprove && recommendation === 'APROVAR' && (await this.approveIfCurrent(doc));
    return this.save(documentId, {
      status: 'CONCLUIDA',
      recommendation,
      findings,
      extracted: maskExtracted(analysis),
      engine: analysis.engine,
      autoApproved: auto,
    });
  }

  /**
   * Aprova sozinho só um documento ainda PENDENTE e que continua sendo o envio mais recente do tipo
   * (não aprova um envio velho por cima de um novo). Sem revisor: `reviewedById` fica nulo.
   */
  private async approveIfCurrent(doc: {
    id: string;
    userId: string;
    type: string;
    vehicleId: string | null;
    createdAt: Date;
  }): Promise<boolean> {
    const newer = await this.prisma.document.count({
      where: {
        userId: doc.userId,
        type: doc.type as VerifiableDocument,
        vehicleId: doc.vehicleId,
        id: { not: doc.id },
        createdAt: { gt: doc.createdAt },
      },
    });
    if (newer > 0) return false;
    const r = await this.prisma.document.updateMany({
      where: { id: doc.id, status: 'PENDENTE' },
      data: { status: 'APROVADO', reviewedAt: new Date(), rejectionReason: null },
    });
    return r.count === 1;
  }

  private save(
    documentId: string,
    v: {
      status: 'CONCLUIDA' | 'INDISPONIVEL';
      recommendation: string | null;
      findings: Finding[];
      extracted: Prisma.InputJsonObject;
      engine: string | null;
      autoApproved: boolean;
    },
  ) {
    const data = { ...v, findings: v.findings as unknown as Prisma.InputJsonArray };
    return this.prisma.documentVerification.upsert({
      where: { documentId },
      create: { documentId, ...data },
      update: data,
    });
  }
}
