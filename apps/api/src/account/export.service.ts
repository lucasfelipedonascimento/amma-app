import { Injectable } from '@nestjs/common';
import { hostDiscountAccount, workerBalanceAccount, workerQuotasAccount } from '@amma/shared';
import { PrismaService } from '../prisma.service';

/**
 * Portabilidade e acesso (LGPD art. 18): tudo o que a AMMA guarda SOBRE a pessoa, em JSON.
 * Regras: só dados do próprio titular; nada de terceiros (o motorista não recebe o endereço do
 * cliente, ninguém recebe o que OUTRA pessoa escreveu sobre ele: notas e comentários recebidos);
 * nunca chaves de armazenamento, tokens de push, hashes nem referências internas do provedor.
 */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async export(userId: string) {
    const p = this.prisma;
    const accounts = [
      workerBalanceAccount(userId),
      workerQuotasAccount(userId),
      hostDiscountAccount(userId),
    ];
    const [
      user,
      consents,
      driverProfile,
      vehicles,
      documents,
      merchant,
      asClient,
      asWorker,
      ratingsGiven,
      reportsMade,
      emergencyAlerts,
      ledger,
      votes,
      queue,
      contributions,
      claims,
      surplus,
      points,
      checkIns,
      pointRatingsGiven,
      blocks,
    ] = await Promise.all([
      p.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, phone: true, name: true, roles: true, createdAt: true },
      }),
      p.consent.findMany({
        where: { userId },
        select: { type: true, version: true, acceptedAt: true },
        orderBy: { acceptedAt: 'asc' },
      }),
      p.driverProfile.findUnique({
        where: { userId },
        select: {
          fullName: true,
          cpf: true,
          birthDate: true,
          associationRate: true,
          gender: true,
          genderVerifiedAt: true,
        },
      }),
      p.vehicle.findMany({
        where: { userId },
        select: { type: true, plate: true, model: true, year: true },
      }),
      // Só os metadados: o arquivo em si fica de fora (peça ao suporte, se precisar).
      p.document.findMany({
        where: { userId },
        select: { type: true, status: true, rejectionReason: true, createdAt: true },
      }),
      p.merchant.findUnique({
        where: { userId },
        select: {
          tradeName: true,
          cnpj: true,
          address: true,
          lat: true,
          lng: true,
          approvalStatus: true,
          rejectionReason: true,
        },
      }),
      p.delivery.findMany({
        where: { clientId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          status: true,
          pickupAddress: true,
          pickupLat: true,
          pickupLng: true,
          dropoffAddress: true,
          dropoffLat: true,
          dropoffLng: true,
          notes: true,
          distanceMeters: true,
          durationSeconds: true,
          fareCents: true,
          cancelReason: true,
          createdAt: true,
          deliveredAt: true,
          payment: {
            select: {
              method: true,
              status: true,
              amountCents: true,
              cardBrand: true,
              cardLast4: true,
              paidAt: true,
              refundedAt: true,
            },
          },
        },
      }),
      // Como motorista: valores e datas do próprio trabalho, sem endereços nem dados do cliente.
      p.delivery.findMany({
        where: { workerId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          status: true,
          distanceMeters: true,
          fareCents: true,
          platformFeeCents: true,
          associationFeeCents: true,
          workerNetCents: true,
          associationRate: true,
          acceptedAt: true,
          deliveredAt: true,
        },
      }),
      p.rating.findMany({
        where: { authorId: userId },
        select: { deliveryId: true, direction: true, stars: true, comment: true, createdAt: true },
      }),
      p.report.findMany({
        where: { reporterId: userId },
        select: {
          category: true,
          description: true,
          status: true,
          resolution: true,
          createdAt: true,
        },
      }),
      p.emergencyAlert.findMany({
        where: { userId },
        select: {
          actorRole: true,
          lat: true,
          lng: true,
          note: true,
          status: true,
          createdAt: true,
        },
      }),
      p.ledgerPosting.findMany({
        where: { account: { in: accounts } },
        orderBy: { transaction: { createdAt: 'asc' } },
        select: {
          account: true,
          direction: true,
          amountCents: true,
          transaction: { select: { kind: true, createdAt: true } },
        },
      }),
      p.vote.findMany({
        where: { voterId: userId },
        select: { proposalId: true, choice: true, castAt: true },
      }),
      p.queueEntry.findMany({
        where: { userId },
        select: { groupId: true, status: true, joinedAt: true, leftAt: true },
      }),
      p.contribution.findMany({
        where: { userId },
        select: { groupId: true, amountCents: true, status: true, createdAt: true },
      }),
      p.insuranceClaim.findMany({
        where: { claimantId: userId },
        select: {
          kind: true,
          occurredAt: true,
          description: true,
          requestedCents: true,
          status: true,
          decisionNote: true,
          approvedCents: true,
          createdAt: true,
        },
      }),
      p.surplusShare.findMany({
        where: { userId },
        select: {
          quotas: true,
          useCents: true,
          amountCents: true,
          run: { select: { year: true } },
        },
      }),
      p.welcomePoint.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          type: true,
          status: true,
          name: true,
          address: true,
          neighborhood: true,
          reference: true,
          lat: true,
          lng: true,
          createdAt: true,
        },
      }),
      p.checkIn.findMany({
        where: { userId },
        select: {
          pointId: true,
          startedAt: true,
          endedAt: true,
          completed: true,
          benefitCents: true,
        },
      }),
      p.pointRating.findMany({
        where: { authorId: userId },
        select: { checkInId: true, direction: true, stars: true, comment: true, createdAt: true },
      }),
      p.accountBlock.findMany({
        where: { userId },
        select: {
          reason: true,
          status: true,
          blockedAt: true,
          appealText: true,
          decisionReason: true,
          revokedAt: true,
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      notice:
        'Dados que a AMMA guarda sobre você. Não inclui o que outras pessoas escreveram sobre você (notas e comentários recebidos), dados de terceiros nem os arquivos dos documentos.',
      account: user,
      consents,
      driver: { profile: driverProfile, vehicles, documents },
      merchant,
      orders: { asClient, asDriver: asWorker },
      ratingsGiven,
      safety: { reportsMade, emergencyAlerts },
      accounting: { ledgerEntries: ledger },
      association: { votes, queue, contributions, insuranceClaims: claims, surplusShares: surplus },
      welcomePoints: { owned: points, checkIns, ratingsGiven: pointRatingsGiven },
      blocks,
    };
  }
}
