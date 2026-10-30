import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  driverApproval,
  isValidCpf,
  isValidVehicleYear,
  normalizePlate,
  type Gender,
} from '@amma/shared';
import { EXTENSION, hasActivePdfContent, sniffMime } from '../common/file-type';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma.service';
import { DriverProfileDto, UploadDocumentDto, VehicleDto } from './dto';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MIN_AGE_YEARS = 18;
/** Teto de envios por conta (cada tipo pode ser reenviado, mas não sem fim: disco e abuso). */
export const MAX_DOCUMENTS_PER_USER = 50;

@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async saveProfile(userId: string, dto: DriverProfileDto) {
    if (!isValidCpf(dto.cpf)) throw new BadRequestException('CPF inválido');
    const birth = new Date(`${dto.birthDate}T00:00:00Z`);
    if (Number.isNaN(birth.getTime())) throw new BadRequestException('Data de nascimento inválida');
    const limit = new Date();
    limit.setUTCFullYear(limit.getUTCFullYear() - MIN_AGE_YEARS);
    if (birth > limit) throw new BadRequestException('É necessário ter 18 anos ou mais');
    const cpf = dto.cpf.replace(/\D/g, '');
    const data = { fullName: dto.fullName.trim(), cpf, birthDate: birth };
    try {
      const genderData = dto.gender === undefined ? {} : await this.genderPatch(userId, dto.gender);
      return await this.prisma.driverProfile.upsert({
        where: { userId },
        create: { userId, ...data, ...genderData },
        update: { ...data, ...genderData },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('CPF já cadastrado');
      throw e;
    }
  }

  /** Mudar o gênero declarado derruba a verificação: a associação precisa conferir de novo. */
  private async genderPatch(userId: string, gender: Gender) {
    const previous = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { gender: true },
    });
    return gender === previous?.gender
      ? {}
      : { gender, genderVerifiedAt: null, genderVerifiedById: null };
  }

  async setGender(userId: string, gender: Gender) {
    const exists = await this.prisma.driverProfile.count({ where: { userId } });
    if (!exists) throw new ConflictException('Preencha seus dados de motorista primeiro');
    const patch = await this.genderPatch(userId, gender);
    const p = await this.prisma.driverProfile.update({
      where: { userId },
      data: patch,
      select: { gender: true, genderVerifiedAt: true },
    });
    return { gender: p.gender, verified: !!p.genderVerifiedAt };
  }

  async addVehicle(userId: string, dto: VehicleDto) {
    const plate = normalizePlate(dto.plate);
    if (!plate) throw new BadRequestException('Placa inválida');
    if (!isValidVehicleYear(dto.year)) throw new BadRequestException('Ano do veículo inválido');
    try {
      return await this.prisma.vehicle.create({
        data: { userId, type: dto.type, plate, model: dto.model.trim(), year: dto.year },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Veículo já cadastrado');
      throw e;
    }
  }

  /** Taxa de associação escolhida (0, 2 ou 4%); vale para as próximas entregas concluídas. */
  async setAssociationRate(userId: string, rate: 0 | 2 | 4) {
    const r = await this.prisma.driverProfile.updateMany({
      where: { userId },
      data: { associationRate: rate },
    });
    if (r.count === 0) throw new ConflictException('Preencha seus dados de motorista primeiro');
    return { associationRate: rate };
  }

  listVehicles(userId: string) {
    return this.prisma.vehicle.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  async uploadDocument(
    userId: string,
    dto: UploadDocumentDto,
    file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Arquivo maior que 5 MB');
    const mime = sniffMime(file.buffer);
    if (mime === 'application/pdf' && hasActivePdfContent(file.buffer))
      throw new BadRequestException(
        'O PDF tem conteúdo ativo (scripts ou arquivos embutidos) e não é aceito.',
      );
    if (!mime) throw new BadRequestException('Formato não suportado. Envie JPG, PNG ou PDF.');
    if (dto.type === 'FOTO' && mime === 'application/pdf')
      throw new BadRequestException('A foto deve ser JPG ou PNG');
    if (dto.type === 'DOCUMENTO_VEICULO') {
      if (!dto.vehicleId) throw new BadRequestException('Informe o veículo do documento');
      const owns = await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, userId } });
      if (!owns) throw new NotFoundException('Veículo não encontrado');
    }
    if ((await this.prisma.document.count({ where: { userId } })) >= MAX_DOCUMENTS_PER_USER)
      throw new ConflictException('Limite de documentos enviados atingido. Fale com a associação.');
    const storageKey = await this.storage.save(file.buffer, EXTENSION[mime]);
    return this.prisma.document.create({
      data: {
        userId,
        type: dto.type,
        vehicleId: dto.vehicleId,
        storageKey,
        mimeType: mime,
        sizeBytes: file.size,
      },
      select: PUBLIC_DOC,
    });
  }

  /** Resumo para a tela de aprovação do app. */
  async status(userId: string) {
    const [profile, vehicles, documents] = await Promise.all([
      this.prisma.driverProfile.findUnique({ where: { userId } }),
      this.prisma.vehicle.count({ where: { userId } }),
      this.prisma.document.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: PUBLIC_DOC,
      }),
    ]);
    const approval = driverApproval(
      documents.map((d) => ({
        type: d.type,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
      })),
    );
    return { approval, profileComplete: !!profile, hasVehicle: vehicles > 0, documents };
  }
}

/** Campos do documento que podem ir ao app (nunca a chave de armazenamento). */
const PUBLIC_DOC = {
  id: true,
  type: true,
  vehicleId: true,
  status: true,
  rejectionReason: true,
  createdAt: true,
} as const;
