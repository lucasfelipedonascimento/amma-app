import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { StorageService } from '../common/storage.service';
import { PRIVACY_POLICY_VERSION } from '../legal/privacy-policy';
import { PositionStore } from '../presence/position-store';
import { PrismaService } from '../prisma.service';
import { OnboardingDto } from './dto';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly positions: PositionStore,
  ) {}

  async me(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { quotaAccount: true },
    });
    return {
      id: u.id,
      phone: u.phone,
      name: u.name,
      roles: u.roles,
      quotaAccount: u.quotaAccount,
      needsOnboarding: u.roles.length === 0,
    };
  }

  async onboarding(userId: string, dto: OnboardingDto) {
    if (dto.policyVersion !== PRIVACY_POLICY_VERSION) {
      throw new BadRequestException(
        'Versão da política desatualizada. Recarregue e leia novamente.',
      );
    }
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // ADMIN nunca sai por aqui, mas também nunca é removido de quem já é admin.
    const roles = [
      ...new Set([...dto.roles, ...(current.roles.includes('ADMIN') ? ['ADMIN' as const] : [])]),
    ];
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { name: dto.name.trim(), roles } }),
      this.prisma.consent.create({
        data: { userId, type: 'POLITICA_PRIVACIDADE', version: dto.policyVersion },
      }),
    ]);
    return this.me(userId);
  }

  /**
   * Exclusão de conta (LGPD): apaga dados pessoais, documentos e sessões e anonimiza o usuário.
   * Corridas e lançamentos financeiros ficam, sem identificação (obrigação legal/contábil).
   */
  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Com pedido em andamento, a outra parte ficaria sem resposta: conclua ou cancele antes.
    const ongoing = await this.prisma.delivery.count({
      where: {
        OR: [{ clientId: userId }, { workerId: userId }],
        status: { notIn: ['ENTREGUE', 'CANCELADO'] },
      },
    });
    if (ongoing > 0)
      throw new ConflictException(
        'Conclua ou cancele seus pedidos em andamento antes de excluir a conta',
      );
    const docs = await this.prisma.document.findMany({
      where: { userId },
      select: { storageKey: true },
    });
    await this.prisma.$transaction([
      this.prisma.deliveryOffer.updateMany({
        where: { driverId: userId, status: 'PENDENTE' },
        data: { status: 'CANCELADA', respondedAt: new Date() },
      }),
      this.prisma.pushToken.deleteMany({ where: { userId } }),
      // Endereço do estabelecimento e textos livres das avaliações são dados pessoais; o resto (valores) fica.
      this.prisma.merchant.deleteMany({ where: { userId } }),
      this.prisma.rating.updateMany({ where: { authorId: userId }, data: { comment: null } }),
      // Segurança (Etapa 7): links de viagem revogados; trajeto apagado, salvo corridas sob denúncia ou
      // alerta (guarda para apuração); texto livre do alerta de emergência apagado.
      this.prisma.tripShare.updateMany({
        where: { delivery: { OR: [{ clientId: userId }, { workerId: userId }] }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.tripPoint.deleteMany({
        where: {
          delivery: {
            OR: [{ clientId: userId }, { workerId: userId }],
            reports: { none: {} },
            emergencyAlerts: { none: {} },
          },
        },
      }),
      this.prisma.emergencyAlert.updateMany({ where: { userId }, data: { note: null } }),
      this.prisma.driverPresence.deleteMany({ where: { userId } }),
      this.prisma.document.deleteMany({ where: { userId } }),
      this.prisma.vehicle.deleteMany({ where: { userId } }),
      this.prisma.driverProfile.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.consent.deleteMany({ where: { userId } }),
      ...(user.phone ? [this.prisma.otpCode.deleteMany({ where: { phone: user.phone } })] : []),
      this.prisma.user.update({
        where: { id: userId },
        data: { phone: null, name: null, roles: [], deletedAt: new Date() },
      }),
    ]);
    await this.positions.remove(userId);
    // Arquivos só depois do banco confirmar.
    await Promise.all(docs.map((d) => this.storage.remove(d.storageKey)));
  }
}
