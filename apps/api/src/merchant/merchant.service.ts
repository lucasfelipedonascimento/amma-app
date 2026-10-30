import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { isValidCnpj, merchantReport, type ReportDelivery } from '@amma/shared';
import { PrismaService } from '../prisma.service';
import { MerchantDto } from './dto';

@Injectable()
export class MerchantService {
  constructor(private readonly prisma: PrismaService) {}

  /** O estabelecimento, ou null se ainda não foi cadastrado. */
  async get(userId: string) {
    const m = await this.prisma.merchant.findUnique({ where: { userId } });
    return m && { ...m, createdAt: undefined, updatedAt: undefined, userId: undefined };
  }

  async save(userId: string, dto: MerchantDto) {
    const cnpj = dto.cnpj?.replace(/\D/g, '') || null;
    if (cnpj && !isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido');
    const data = {
      tradeName: dto.tradeName.trim(),
      cnpj,
      address: dto.address.trim(),
      lat: dto.lat,
      lng: dto.lng,
    };
    try {
      await this.prisma.merchant.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Este CNPJ já está cadastrado');
      throw e;
    }
    return this.get(userId);
  }

  /** Relatório simples dos pedidos do comerciante nos últimos `days` dias. */
  async report(userId: string, days = 30, now = new Date()) {
    const since = new Date(now.getTime() - (days + 1) * 86_400_000);
    const rows = await this.prisma.delivery.findMany({
      where: { clientId: userId, createdAt: { gte: since } },
      select: {
        createdAt: true,
        status: true,
        fareCents: true,
        payment: { select: { status: true } },
      },
    });
    const list: ReportDelivery[] = rows.map((d) => ({
      createdAt: d.createdAt.toISOString(),
      status: d.status,
      fareCents: d.fareCents,
      paymentStatus: d.payment?.status ?? null,
    }));
    return merchantReport(list, now, days);
  }
}
