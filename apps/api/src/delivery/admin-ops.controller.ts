import {
  Body,
  Controller,
  Get,
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
import { DispatchSettingsDto, PricingDto } from './dto';

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
    return this.pricing.create({ ...dto, effectiveFrom: new Date(dto.effectiveFrom) }, req.user.id);
  }

  @Get('deliveries/:id/events')
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.events(id);
  }
}
