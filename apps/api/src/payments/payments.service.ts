import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PIX_TTL_SECONDS, buildPaymentSplit, refundAction, type PaymentMethod } from '@amma/shared';
import type { Payment } from '@prisma/client';
import { cancelDelivery } from '../delivery/transitions';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  PAYMENT_PROVIDER,
  PaymentUnavailableError,
  type PaymentEvent,
  type PaymentProvider,
} from './payment-provider';

export interface ChargeInput {
  reference: string;
  amountCents: number;
  method: PaymentMethod;
  cardToken?: string;
}

/** Resultado da cobrança, pronto para gravar em `Payment`. */
export interface ChargeResult {
  method: PaymentMethod;
  status: 'PENDENTE' | 'PAGO';
  provider: string;
  providerRef: string;
  amountCents: number;
  pixCode?: string;
  pixExpiresAt?: Date;
  cardBrand?: string;
  cardLast4?: string;
  paidAt?: Date;
}

export function paymentView(p: Payment, provider: PaymentProvider) {
  return {
    method: p.method,
    status: p.status,
    amountCents: p.amountCents,
    // O código do Pix só serve enquanto não foi pago.
    pixCode: p.status === 'PENDENTE' ? p.pixCode : null,
    pixExpiresAt: p.pixExpiresAt,
    cardBrand: p.cardBrand,
    cardLast4: p.cardLast4,
    paidAt: p.paidAt,
    refundedAt: p.refundedAt,
    sandbox: provider.sandbox,
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Pagamentos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider,
  ) {}

  /**
   * Cobra no provedor. Cartão: aprovado na hora, ou 402 se recusado (nada é criado).
   * Pix: devolve o código e fica PENDENTE até o provedor avisar que foi pago.
   */
  async charge(i: ChargeInput): Promise<ChargeResult> {
    const base = { method: i.method, provider: this.provider.name, amountCents: i.amountCents };
    try {
      if (i.method === 'PIX') {
        const pixExpiresAt = new Date(Date.now() + PIX_TTL_SECONDS * 1000);
        const pix = await this.provider.createPix({
          reference: i.reference,
          amountCents: i.amountCents,
          expiresAt: pixExpiresAt,
        });
        return { ...base, status: 'PENDENTE', ...pix, pixExpiresAt };
      }
      if (!i.cardToken) throw new HttpException('Informe o cartão', HttpStatus.BAD_REQUEST);
      const r = await this.provider.chargeCard({
        reference: i.reference,
        amountCents: i.amountCents,
        cardToken: i.cardToken,
      });
      if (!r.approved) throw new HttpException(r.reason, HttpStatus.PAYMENT_REQUIRED);
      return {
        ...base,
        status: 'PAGO',
        providerRef: r.providerRef,
        cardBrand: r.brand,
        cardLast4: r.last4,
        paidAt: new Date(),
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`Provedor indisponível: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        e instanceof PaymentUnavailableError
          ? 'O pagamento está indisponível agora. Tente de novo em instantes.'
          : 'Não foi possível processar o pagamento agora',
      );
    }
  }

  /** Devolve uma cobrança que não virou pedido (falha ao gravar depois de cobrar). Não lança. */
  async undoCharge(c: ChargeResult) {
    if (c.status !== 'PAGO') return;
    await this.provider
      .refund({ providerRef: c.providerRef, amountCents: c.amountCents })
      .catch((e: Error) =>
        this.logger.error(`ESTORNO MANUAL NECESSÁRIO ${c.providerRef}: ${e.message}`),
      );
  }

  /**
   * Entrada do aviso "Pix pago" (no provedor real, o webhook). Idempotente: avisar de novo não
   * muda nada. Devolve o pedido só na primeira vez, para quem chamou iniciar o despacho.
   */
  async confirmPix(providerRef: string): Promise<{ deliveryId: string; justPaid: boolean }> {
    const p = await this.prisma.payment.findUnique({ where: { providerRef } });
    if (!p || p.method !== 'PIX') throw new NotFoundException('Pagamento não encontrado');
    const now = new Date();
    const r = await this.prisma.payment.updateMany({
      where: { id: p.id, status: 'PENDENTE', pixExpiresAt: { gt: now } },
      data: { status: 'PAGO', paidAt: now },
    });
    if (r.count === 1) {
      await this.notifyClient(p.deliveryId, 'PAGO');
      return { deliveryId: p.deliveryId, justPaid: true };
    }
    if (p.status === 'PAGO') return { deliveryId: p.deliveryId, justPaid: false };
    // Pago depois de vencer: o cliente não pode ficar sem o dinheiro nem sem o pedido.
    throw new HttpException('Este Pix já venceu e o pedido foi cancelado', HttpStatus.CONFLICT);
  }

  /**
   * Trata um aviso do provedor já validado. Idempotente por (provedor, eventId): o provedor reenvia
   * avisos, e repetir não pode pagar o pedido nem estornar duas vezes.
   * `justPaid` diz ao chamador para iniciar o despacho.
   */
  async handleEvent(e: PaymentEvent): Promise<{ deliveryId?: string; justPaid: boolean }> {
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: { provider: this.provider.name, eventId: e.eventId, type: e.type },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return { justPaid: false };
      throw err;
    }
    try {
      const r = await this.confirmPix(e.providerRef);
      return r;
    } catch (err) {
      if (err instanceof NotFoundException) {
        // Pagamento que não conhecemos: registra e responde 200 (reenviar não adianta).
        this.logger.warn(`Aviso do provedor para cobrança desconhecida ${e.providerRef}`);
        return { justPaid: false };
      }
      if (err instanceof HttpException && err.getStatus() === HttpStatus.CONFLICT) {
        await this.refundLatePix(e.providerRef);
        return { justPaid: false };
      }
      // Falha nossa: apaga o registro para o provedor poder reenviar e tentarmos de novo.
      await this.prisma.paymentWebhookEvent
        .deleteMany({ where: { provider: this.provider.name, eventId: e.eventId } })
        .catch(() => undefined);
      throw err;
    }
  }

  /** Pix pago depois de vencer (pedido já cancelado): devolve o dinheiro ao cliente. */
  private async refundLatePix(providerRef: string) {
    const p = await this.prisma.payment.findUnique({ where: { providerRef } });
    if (!p || p.status !== 'EXPIRADO') return;
    const { refundRef } = await this.provider.refund({ providerRef, amountCents: p.amountCents });
    await this.prisma.payment.updateMany({
      where: { id: p.id, status: 'EXPIRADO' },
      data: {
        status: 'ESTORNADO',
        paidAt: new Date(),
        refundedAt: new Date(),
        refundRef,
        refundReason: 'PIX_PAGO_APOS_VENCER',
      },
    });
    await this.notifyClient(p.deliveryId, 'ESTORNADO');
  }

  /**
   * Repasse depois do ENTREGUE: manda ao provedor a divisão (trabalhador, taxa base, associação) das
   * taxas congeladas no pedido. Idempotente; não lança (a rotina periódica repete o que falhou).
   */
  async settleSplit(deliveryId: string): Promise<boolean> {
    try {
      const d = await this.prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { payment: true },
      });
      const p = d?.payment;
      if (!d || !p || d.status !== 'ENTREGUE' || !d.workerId) return false;
      if (p.status !== 'PAGO' || p.splitSettledAt) return false;
      const lines = buildPaymentSplit({
        grossCents: p.amountCents,
        workerId: d.workerId,
        workerNetCents: d.workerNetCents ?? 0,
        platformFeeCents: d.platformFeeCents ?? 0,
        associationFeeCents: d.associationFeeCents ?? 0,
      });
      const { splitRef } = await this.provider.settleSplit({
        providerRef: p.providerRef,
        reference: deliveryId,
        lines,
      });
      await this.prisma.payment.updateMany({
        where: { id: p.id, splitSettledAt: null },
        data: { splitSettledAt: new Date(), splitRef },
      });
      return true;
    } catch (e) {
      this.logger.error(`Repasse pendente do pedido ${deliveryId}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Depois de um cancelamento: estorna o que foi pago ou invalida o Pix pendente. Não lança. */
  async afterCancel(deliveryId: string) {
    try {
      const d = await this.prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { payment: true },
      });
      if (!d?.payment) return;
      const action = refundAction(d.status, d.payment.status);
      if (action === 'ESTORNAR') await this.refund(deliveryId, 'PEDIDO_CANCELADO');
      else if (action === 'EXPIRAR') {
        await this.prisma.payment.updateMany({
          where: { id: d.payment.id, status: 'PENDENTE' },
          data: { status: 'EXPIRADO' },
        });
        await this.notifyClient(deliveryId, 'EXPIRADO');
      }
    } catch (e) {
      // A rotina periódica tenta de novo (retryRefunds).
      this.logger.error(
        `Falha ao tratar pagamento do pedido ${deliveryId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Estorno total. Primeiro o provedor (idempotente), depois o banco com compare-and-set:
   * se o banco falhar, repetir é seguro. Devolve false se já não estava PAGO.
   */
  async refund(deliveryId: string, reason: string): Promise<boolean> {
    const p = await this.prisma.payment.findUnique({ where: { deliveryId } });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    if (p.status !== 'PAGO') return false;
    const { refundRef } = await this.provider.refund({
      providerRef: p.providerRef,
      amountCents: p.amountCents,
    });
    const r = await this.prisma.payment.updateMany({
      where: { id: p.id, status: 'PAGO' },
      data: { status: 'ESTORNADO', refundedAt: new Date(), refundRef, refundReason: reason },
    });
    if (r.count === 1) await this.notifyClient(deliveryId, 'ESTORNADO');
    return r.count === 1;
  }

  /** Rotina periódica: vence Pix não pago (cancelando o pedido) e repete estornos que falharam. */
  async tick() {
    const overdue = await this.prisma.payment.findMany({
      where: { status: 'PENDENTE', pixExpiresAt: { lte: new Date() } },
      select: { id: true, deliveryId: true },
      take: 100,
    });
    for (const p of overdue) await this.expirePix(p.id, p.deliveryId);

    const stuck = await this.prisma.payment.findMany({
      where: { status: 'PAGO', delivery: { status: 'CANCELADO' } },
      select: { deliveryId: true },
      take: 100,
    });
    for (const p of stuck) await this.afterCancel(p.deliveryId);

    const unsettled = await this.prisma.payment.findMany({
      where: { status: 'PAGO', splitSettledAt: null, delivery: { status: 'ENTREGUE' } },
      select: { deliveryId: true },
      take: 100,
    });
    for (const p of unsettled) await this.settleSplit(p.deliveryId);
  }

  private async expirePix(paymentId: string, deliveryId: string) {
    try {
      const clientId = await this.prisma.$transaction(async (tx) => {
        const moved = await cancelDelivery(tx, {
          id: deliveryId,
          from: 'CRIADO',
          reason: 'PAGAMENTO_NAO_CONFIRMADO',
        });
        if (!moved) return null;
        const r = await tx.payment.updateMany({
          where: { id: paymentId, status: 'PENDENTE' },
          data: { status: 'EXPIRADO' },
        });
        // Pago neste meio-tempo: desfaz o cancelamento (a transação inteira volta).
        if (r.count === 0) throw new Error('PAGO_NO_MEIO_TEMPO');
        return (await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).clientId;
      });
      if (clientId) {
        this.realtime.sendToUser(clientId, 'delivery.updated', {
          id: deliveryId,
          status: 'CANCELADO',
          cancelReason: 'PAGAMENTO_NAO_CONFIRMADO',
        });
        await this.notifyClient(deliveryId, 'EXPIRADO');
      }
    } catch (e) {
      if ((e as Error).message === 'PAGO_NO_MEIO_TEMPO') return;
      this.logger.error(`Falha ao vencer o Pix do pedido ${deliveryId}: ${(e as Error).message}`);
    }
  }

  private async notifyClient(deliveryId: string, status: string) {
    const d = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { clientId: true },
    });
    if (d) this.realtime.sendToUser(d.clientId, 'payment.updated', { deliveryId, status });
  }
}
