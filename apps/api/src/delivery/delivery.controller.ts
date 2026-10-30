import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { CancelDto, CreateDeliveryDto, ListDeliveriesQuery } from './dto';
import { DeliveryService } from './delivery.service';

type Req_ = { user: AuthUser };

/** Pedidos de entrega, do lado de quem pede (passageiro/comerciante). */
@Controller('deliveries')
@UseGuards(AuthGuard, RolesGuard)
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Post('quote')
  @HttpCode(200)
  @Roles('PASSAGEIRO', 'COMERCIANTE')
  quote(@Body() dto: CreateDeliveryDto) {
    return this.deliveries.quote(dto);
  }

  @Post()
  @Roles('PASSAGEIRO', 'COMERCIANTE')
  create(@Req() req: Req_, @Body() dto: CreateDeliveryDto) {
    return this.deliveries.create(req.user, dto);
  }

  @Get()
  @Roles('PASSAGEIRO', 'COMERCIANTE')
  list(@Req() req: Req_, @Query() q: ListDeliveriesQuery) {
    return this.deliveries.list(req.user.id, q.status, q.limit);
  }

  // Dono, motorista responsável ou admin (a checagem fina é no serviço).
  @Get(':id')
  get(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.get(req.user, id);
  }

  // Cliente (desistir), motorista (coleta/entrega impossível) ou admin: o serviço confere o ator.
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.deliveries.cancel(req.user, id, dto);
  }
}
