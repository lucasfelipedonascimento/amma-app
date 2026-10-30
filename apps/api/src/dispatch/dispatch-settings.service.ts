import { BadRequestException, Injectable } from '@nestjs/common';
import { DEFAULT_DISPATCH_CONFIG, validateDispatchConfig, type DispatchConfig } from '@amma/shared';
import { PrismaService } from '../prisma.service';

/** Parâmetros do despacho em linha única no banco; sem linha, valem os padrões do shared. */
@Injectable()
export class DispatchSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<DispatchConfig> {
    const row = await this.prisma.dispatchSettings.findUnique({ where: { id: 1 } });
    if (!row) return { ...DEFAULT_DISPATCH_CONFIG };
    return {
      radiusMeters: row.radiusMeters,
      offerTtlSeconds: row.offerTtlSeconds,
      maxSearchSeconds: row.maxSearchSeconds,
      maxPositionAgeSeconds: row.maxPositionAgeSeconds,
    };
  }

  async update(config: DispatchConfig, adminId: string): Promise<DispatchConfig> {
    const errors = validateDispatchConfig(config);
    if (errors.length > 0) throw new BadRequestException(errors);
    await this.prisma.dispatchSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...config, updatedById: adminId },
      update: { ...config, updatedById: adminId },
    });
    return config;
  }
}
