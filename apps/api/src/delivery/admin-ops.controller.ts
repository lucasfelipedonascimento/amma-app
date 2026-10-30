import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { DispatchSettingsService } from '../dispatch/dispatch-settings.service';
import { PricingService } from '../pricing/pricing.service';
import { DeliveryService } from './delivery.service';
import { DispatchSettingsDto, PricingDto, RefundDto } from './dto';

/** Configuração e auditoria do despacho/preço (somente administrador). */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminOpsController {
  constructor(
    private readonly settings: DispatchSettingsService,
    private readonly pricing: PricingService,
    private readonly deliveries: DeliveryService,
  ) {}

  @Get('dispatch-settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('dispatch-settings')
  putSettings(@Req() req: { user: AuthUser }, @Body() dto: DispatchSettingsDto) {
    return this.settings.update({ ...dto }, req.user.id);
  }

  @Get('pricing')
  listPricing() {
    return this.pricing.list();
  }

  @Post('pricing')
  createPricing(@Req() req: { user: AuthUser }, @Body() dto: PricingDto) {
    const { profile, ...table } = dto;
    return this.pricing.create(
      { ...table, effectiveFrom: new Date(dto.effectiveFrom) },
      req.user.id,
      profile,
    );
  }

  @Get('deliveries/:id/events')
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.events(id);
  }

  @Post('deliveries/:id/refund')
  @HttpCode(200)
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    return this.deliveries.adminRefund(id, dto.reason);
  }
}
