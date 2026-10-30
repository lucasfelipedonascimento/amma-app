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
  Req,
  UseGuards,
} from '@nestjs/common';
import { PAYMENT_METHODS } from '@amma/shared';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { DispatchService } from '../dispatch/dispatch.service';
import { PrismaService } from '../prisma.service';
import { SandboxCardDto } from './dto';
import { SandboxPaymentProvider } from './payment-provider';
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
