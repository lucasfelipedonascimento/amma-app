import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { selectPricingConfig, type PricingConfig, type PricingProfile } from '@amma/shared';
import { PrismaService } from '../prisma.service';

const toConfig = (r: {
  version: string;
  effectiveFrom: Date;
  baseCents: number;
  perKmCents: number;
  perMinuteCents: number;
  minimumFareCents: number;
}): PricingConfig => ({ ...r, effectiveFrom: r.effectiveFrom.toISOString() });

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.pricingConfigVersion.findMany({
      orderBy: [{ profile: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /** Tabela vigente em `at` para o perfil (entrega, corrida de carro ou de moto). Sem tabela, não há como cotar. */
  async current(at = new Date(), profile: PricingProfile = 'ENTREGA'): Promise<PricingConfig> {
    const rows = await this.prisma.pricingConfigVersion.findMany({ where: { profile } });
    try {
      return selectPricingConfig(rows.map(toConfig), at);
    } catch {
      throw new ServiceUnavailableException('Tabela de preços não configurada');
    }
  }

  /**
   * Nova versão. Versões antigas nunca são editadas, e a nova precisa valer a partir de um
   * momento posterior ao das existentes (não dá para reescrever o passado).
   */
  async create(
    input: Omit<PricingConfig, 'effectiveFrom'> & { effectiveFrom: Date },
    adminId: string,
    profile: PricingProfile = 'ENTREGA',
  ) {
    const latest = await this.prisma.pricingConfigVersion.findFirst({
      where: { profile },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (latest && input.effectiveFrom <= latest.effectiveFrom)
      throw new ConflictException(
        'effectiveFrom deve ser posterior ao da última versão deste perfil',
      );
    try {
      return await this.prisma.pricingConfigVersion.create({
        data: { ...input, profile, createdById: adminId },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Já existe uma versão com este identificador');
      throw e;
    }
  }
}
