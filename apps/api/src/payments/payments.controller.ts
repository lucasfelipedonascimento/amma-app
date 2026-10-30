import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Headers,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { PAYMENT_METHODS } from '@amma/shared';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { DispatchService } from '../dispatch/dispatch.service';
import { PrismaService } from '../prisma.service';
import { SandboxCardDto } from './dto';
import { Public } from '../auth/public';
import { InvalidWebhookError, SandboxPaymentProvider } from './payment-provider';
import { PaymentsService } from './payments.service';

type Req_ = { user: AuthUser };

@Controller('payments')
@UseGuards(AuthGuard, RolesGuard)
@Roles('PASSAGEIRO', 'COMERCIANTE')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly dispatch: DispatchService,
    private readonly prisma: PrismaService,
  ) {}

  /** O app usa isto para saber se mostra os botões de teste. */
  @Get('config')
  config() {
    return {
      provider: this.payments.provider.name,
      sandbox: this.payments.provider.sandbox,
      methods: PAYMENT_METHODS,
    };
  }

  /** Sandbox: troca os dados do cartão de teste por um token. Em produção (provedor real) não existe. */
  @Post('sandbox/card-tokens')
  @HttpCode(200)
  cardToken(@Body() dto: SandboxCardDto) {
    const provider = this.payments.provider;
    if (!(provider instanceof SandboxPaymentProvider)) throw new NotFoundException();
    try {
      return provider.tokenizeCard(dto);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /**
   * Sandbox: simula o aviso "Pix pago" do provedor. Só o dono do pedido. Com o provedor real, quem
   * avisa é o webhook do provedor (a ser ligado a `PaymentsService.confirmPix`).
   */
  @Post('sandbox/pix/:deliveryId/confirm')
  @HttpCode(200)
  async confirmPix(@Req() req: Req_, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) {
    if (!this.payments.provider.sandbox) throw new NotFoundException();
    const p = await this.prisma.payment.findFirst({
      where: { deliveryId, delivery: { clientId: req.user.id }, method: 'PIX' },
    });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    const r = await this.payments.confirmPix(p.providerRef);
    // Pago: agora o pedido pode ir para o despacho.
    if (r.justPaid) await this.dispatch.dispatch(deliveryId).catch(() => undefined);
    return { deliveryId, status: 'PAGO' };
  }
}

/**
 * Aviso do provedor de pagamento (webhook). Aberto de propósito (o provedor não tem login): a
 * autenticidade vem da ASSINATURA do corpo, conferida pelo provedor (`parseWebhook`). Sem assinatura
 * válida: 401, sem tocar em nada.
 */
@Controller('payments')
@Public()
export class PaymentsWebhookController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly dispatch: DispatchService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (!req.rawBody) throw new BadRequestException('Corpo ausente');
    let event;
    try {
      event = this.payments.provider.parseWebhook(req.rawBody, headers);
    } catch (e) {
      if (e instanceof InvalidWebhookError) throw new UnauthorizedException();
      throw e;
    }
    if (!event) return { received: true };
    const r = await this.payments.handleEvent(event);
    if (r.justPaid && r.deliveryId)
      await this.dispatch.dispatch(r.deliveryId).catch(() => undefined);
    return { received: true };
  }
}
