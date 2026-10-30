import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Public } from '../auth/public';
import { GroupPurchaseService } from './group-purchase.service';

/**
 * Aviso do parceiro financeiro (webhook). Aberto de propósito (o parceiro não tem login): a
 * autenticidade vem da ASSINATURA do corpo, conferida pelo parceiro (`parseWebhook`). Sem assinatura
 * válida: 401, sem tocar em nada.
 */
@Controller('partner')
@Public()
export class PartnerWebhookController {
  constructor(private readonly purchase: GroupPurchaseService) {}

  @Post('webhook')
  @HttpCode(200)
  receive(
    @Req() req: RawBodyRequest<unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (!req.rawBody) throw new BadRequestException('Corpo ausente');
    return this.purchase.handlePartnerWebhook(req.rawBody, headers);
  }
}
